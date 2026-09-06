import { ref, getDownloadURL } from "firebase/storage";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
} from "firebase/firestore/lite";
import dotenv from "dotenv";

import { db, storage, authReady } from "../../app/firebase";

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Calls OpenAI's Chat Completions API directly instead of going through
// langchain's ChatOpenAI/LLMChain - see fetchHeadlines.js for the full
// story: langchain's bundled HTTP client (this project pins langchain
// ^0.0.124, from mid-2023) hangs indefinitely on this exact same request
// instead of erroring or completing. A direct fetch avoids it entirely.
async function callOpenAI(promptText, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [{ role: "user", content: promptText }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  // gpt-4o often wraps JSON replies in a ```json ... ``` markdown fence
  // despite being asked for raw JSON - strip it before JSON.parse, or it
  // throws on the leading backtick.
  return content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

// Vercel's default serverless function duration is too short for a GPT-4
// chain call - without this the function gets killed mid-request and the
// client sees a 504 regardless of whether the OpenAI call would have
// eventually succeeded.
export const config = { maxDuration: 60 };

const weeklyArticlesRef = collection(db, "Weekly Articles");

async function getCurrentWeek() {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl");
  const state = await res.json();
  return state.season_type === "post" ? 18 : state.display_week || 1;
}

// Playoff predictions only need to change when the NFL week rolls over -
// generating them fresh on every request burns an OpenAI call (and risks a
// timeout) for content that hasn't gone stale. This checks first and only
// pays for generation once per week per league, regardless of caller.
async function getCachedPredictions(leagueId, currentWeek) {
  const snap = await getDocs(query(weeklyArticlesRef, where("league_id", "==", leagueId)));
  if (snap.empty) return { doc: null, fresh: null };
  const data = snap.docs[0].data();
  const fresh = data.playoff_predictions_week === currentWeek && data.playoff_predictions ? data.playoff_predictions : null;
  return { doc: snap.docs[0], fresh };
}

const updateWeeklyInfo = async (existingDoc, REACT_APP_LEAGUE_ID, articles, week) => {
  const dataToUpdate = { playoff_predictions: articles, playoff_predictions_week: week };
  if (existingDoc) {
    await updateDoc(existingDoc.ref, dataToUpdate);
  } else {
    await addDoc(weeklyArticlesRef, { league_id: REACT_APP_LEAGUE_ID, ...dataToUpdate });
  }
};

// Races the OpenAI call against a deadline safely inside Vercel's own
// maxDuration, so a slow completion degrades to a clean fallback response
// instead of the whole function getting hard-killed with no response body.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms)),
  ]);
}

// req.body isn't guaranteed to be a plain string - depending on the
// client's Content-Type header, Next's body parser can hand back an
// object or a raw Buffer instead, which then throws "Cannot convert
// object to primitive value" the moment it's used in a template literal
// or a Firestore query value. Always normalize to a real string first.
function normalizeLeagueId(body) {
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return normalizeLeagueId(body[0]);
  if (Buffer.isBuffer(body)) return body.toString("utf8").replace(/^"|"$/g, "");
  if (body && typeof body === "object" && typeof body.leagueId === "string") return body.leagueId;
  // Some client payload shapes genuinely can't be coerced to a string at
  // all (even String() throws on certain exotic objects) - never let that
  // crash the handler, just fall through to an empty id, which fails
  // cleanly further down instead of with an unhandled TypeError.
  try {
    return String(body ?? "");
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  const REACT_APP_LEAGUE_ID = normalizeLeagueId(req.body);

  try {
    await authReady;
    const currentWeek = await getCurrentWeek();
    const { doc: existingDoc, fresh } = await getCachedPredictions(REACT_APP_LEAGUE_ID, currentWeek);
    if (fresh) {
      return res.status(200).json(fresh);
    }

    const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}_preview.txt`);
    const url = await getDownloadURL(readingRef);
    const response = await fetch(url);
    const fileContent = await response.text();
    const leagueData = JSON.stringify(fileContent).replace(/\//g, "");

    const basePrompt = `
      Your name is El Jefe and you're the Head of Media department over at the Fantasy Pulse website.
      You are an extremely over confident analyst that relies on years of experience and gut instinct over anything else.
     Dismiss the draft grades and playoff chances that the fantasy pulse analytics team provides and even make fun of the nerd stats, that's not REAL fantasy football. It is the first game of the season, and no games have been played yet. Write a witty and entertaining article titled "WAY TOO EARLY POWER RANKINGS" based on the provided league data. 
     Include all teams, each only once, with their playoff chances (percentage out of 100) and predicted record out of 14 games. Use confident, instinct-driven analysis with a touch of humor including jokes about their teamnames or players, 
      include their players in your analysis as well as which players you'll think will underperform or overachieve or even down right dismiss some teams from even having a chance to make it while boasting and making them seem like a sure fire playoff contender. The JSON response format should strictly adhere to the following structure:
      
        "description": "",
        "title": "",
        "paragraph1": "",
        "paragraph2": "",
        "paragraph3": "",
        "paragraph4": "",
        "paragraph5": "",
        "paragraph6": "",
        "paragraph7": ""
      
      Make sure all teams are listed and there are no duplicates.
      Here is the league data: ${leagueData}
    `;

    const text = await withTimeout(callOpenAI(basePrompt, "gpt-4o"), 45000);
    const predictions = JSON.parse(text);

    await updateWeeklyInfo(existingDoc, REACT_APP_LEAGUE_ID, predictions, currentWeek);
    return res.status(200).json(predictions);
  } catch (error) {
    // Non-2xx so the client's existing null-article fallback kicks in
    // instead of caching a failure as if it were real content.
    console.error("Unexpected error:", error);
    if (!res.headersSent) {
      res.status(503).json({ error: "Failed to generate playoff predictions" });
    }
  }
}
