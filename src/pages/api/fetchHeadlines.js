import { ref, getDownloadURL } from "firebase/storage";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
} from "firebase/firestore/lite";

import { db, storage, authReady } from "../../app/firebase";

// Vercel's default serverless function duration is too short for a GPT-4
// chain call - without this the function gets killed mid-request and the
// client sees a 504 regardless of whether the OpenAI call would have
// eventually succeeded.
export const config = { maxDuration: 60 };

const weeklyHeadlinesRef = collection(db, "Weekly Headlines");

async function getCurrentWeek() {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl");
  const state = await res.json();
  return state.season_type === "post" ? 18 : state.display_week || 1;
}

// Headlines only need to change when the NFL week rolls over - generating
// them fresh on every request burns an OpenAI call (and risks a timeout)
// for content that hasn't actually gone stale. Callers no longer need to
// self-cache: this checks first and only pays for generation once per week
// per league, regardless of who calls it or how often.
async function getCachedHeadlines(leagueId, currentWeek) {
  const snap = await getDocs(query(weeklyHeadlinesRef, where("league_id", "==", leagueId)));
  if (snap.empty) return { doc: null, fresh: null };
  const data = snap.docs[0].data();
  const fresh = data.week === currentWeek && Array.isArray(data.headlines) ? data.headlines : null;
  return { doc: snap.docs[0], fresh };
}

async function saveHeadlines(leagueId, existingDoc, headlines, week) {
  if (existingDoc) {
    await updateDoc(existingDoc.ref, { headlines, week });
  } else {
    await addDoc(weeklyHeadlinesRef, { league_id: leagueId, headlines, week });
  }
}

// Calls OpenAI's Chat Completions API directly instead of going through
// langchain's ChatOpenAI/LLMChain - confirmed via a raw fetch probe that
// the API key, network path, and model are all fine, but langchain's
// bundled HTTP client (this project pins langchain ^0.0.124, from mid-2023)
// hangs indefinitely on this exact same request instead of erroring or
// completing. A direct fetch avoids whatever is broken in that old client.
async function callOpenAI(promptText, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
  // gpt-4-turbo/gpt-4o often wrap JSON replies in a ```json ... ``` markdown
  // fence despite being asked for raw JSON - strip it before the caller
  // JSON.parses the result, or it throws on the leading backtick.
  return content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

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
    const { doc: existingDoc, fresh } = await getCachedHeadlines(REACT_APP_LEAGUE_ID, currentWeek);
    if (fresh) {
      return res.status(200).json(fresh);
    }

    const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}.txt`);
    const url = await getDownloadURL(readingRef);
    const response = await fetch(url);
    const fileContent = await response.text();
    const newFile = JSON.stringify(fileContent).replace(/\//g, "");

    const promptText = `${newFile} give me 3 creative exciting and funny sports style headlines previewing this weeks fantasy football matchups, pick any 3 matchups to cover and make title's creative and exciting. Each headline should look like an exciting anticipated sports matchup.
  include the teams, star players and key matchups in the matchup preview, include a bit of humor and be creative with the titles and descriptions. I want the information to be in this format exactly headline:
  "id": "",
  "category": "",
  "title": "",
  "description": ""
 keep response concise and exciting. give me the response in valid JSON array format. Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies.`;

    const text = await withTimeout(callOpenAI(promptText, "gpt-4-turbo"), 45000);
    const headlines = JSON.parse(text);

    await saveHeadlines(REACT_APP_LEAGUE_ID, existingDoc, headlines, currentWeek);
    return res.status(200).json(headlines);
  } catch (error) {
    // Non-2xx so the client's existing default-headlines fallback kicks in
    // and it doesn't cache a failure as if it were real content - see
    // HomeCarousel.tsx, which only caches an array response to Firestore.
    console.error("Unexpected error:", error);
    return res.status(503).json({ error: "Failed to generate headlines" });
  }
}
