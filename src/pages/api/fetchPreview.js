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
import { serverTimestamp } from "firebase/firestore/lite";

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_TOKENS = 8192; // GPT-4 turbo token limit

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
  return data.choices?.[0]?.message?.content ?? "";
}

// Vercel's default serverless function duration is too short for a GPT-4
// chain call (or several, when the league data is chunked below) - without
// this the function gets killed mid-request and the client sees a 504.
export const config = { maxDuration: 60 };

const weeklyArticlesRef = collection(db, "Weekly Articles");

async function getCurrentWeek() {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl");
  const state = await res.json();
  return state.season_type === "post" ? 18 : state.display_week || 1;
}

// The weekly preview only needs to change when the NFL week rolls over -
// generating it fresh on every request burns an OpenAI call (and risks a
// timeout) for content that hasn't gone stale. This checks first and only
// pays for generation once per week per league, regardless of caller.
async function getCachedPreview(leagueId, currentWeek) {
  const snap = await getDocs(query(weeklyArticlesRef, where("league_id", "==", leagueId)));
  if (snap.empty) return { doc: null, fresh: null };
  const data = snap.docs[0].data();
  const fresh = data.preview_week === currentWeek && data.preview ? data.preview : null;
  return { doc: snap.docs[0], fresh };
}

const updateWeeklyInfo = async (existingDoc, leagueId, preview, week) => {
  const dataToUpdate = {
    preview,
    preview_week: week,
    timestamp: serverTimestamp(),
    type: "preview",
  };

  if (existingDoc) {
    await updateDoc(existingDoc.ref, dataToUpdate);
  } else {
    await addDoc(weeklyArticlesRef, { league_id: leagueId, ...dataToUpdate });
  }
};

function countTokens(inputString) {
  return inputString.split(/\s+|\b/).filter((word) => word.trim() !== "")
    .length;
}

// Races a chunk's OpenAI call against a deadline safely inside Vercel's own
// maxDuration, so a slow completion ends the stream cleanly instead of the
// whole function getting hard-killed with a truncated response body.
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
  const MAX_TOKENS = 8192;

  try {
    if (!REACT_APP_LEAGUE_ID) {
      return res.status(400).json({ error: "league_id is required" });
    }

    await authReady;
    const currentWeek = await getCurrentWeek();
    const { doc: existingDoc, fresh } = await getCachedPreview(REACT_APP_LEAGUE_ID, currentWeek);
    if (fresh) {
      return res.status(200).json(fresh);
    }

    const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}_preview.txt`);
    const url = await getDownloadURL(readingRef);

    const response = await fetch(url);
    const fileContent = await response.text();
    const leagueData = JSON.stringify(fileContent).replace(/\//g, "");
    const tokenCount = countTokens(leagueData);

    let promptTemplate;
    if (tokenCount > MAX_TOKENS) {
      promptTemplate = `
        Here is the league data: __LEAGUE_DATA__
        Give me an article previewing each matchup in this fantasy football league and your predictions for how it'll turn out. 
        Make each matchup breakdown creative, funny, and exciting while also keeping it concise. 
        Provide an exciting one sentence description/preview of what the article will entail that will hook the readers to read the rest of the article.
        The format of the JSON response should strictly adhere to RFC8259 compliance, without any deviations or errors. The JSON structure should match this template:
        "description": "",
        "title": "",
        "paragraph1": "",
        "paragraph2": "",
        "paragraph3": "",
        "paragraph4": "",
        "paragraph5": "",
        "paragraph6": "",
        "paragraph7": ""
      Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies.  
      `;
    } else {
      promptTemplate = `
        Here is the league data: __LEAGUE_DATA__
        Your name is Boogie the writer and you've been getting a lot of heat for your predictions last week. 
        Give me an article previewing each matchup in this fantasy football league, include their star players based off their projected points, 
        and your predictions for how it'll turn out, double down on how certain you are this time and that league members should trust your years of experience/research.
        Make each matchup breakdown creative, funny, and exciting. Provide an exciting one sentence description/preview of what the article will entail that will hook the readers to read the rest of the article.
        The format of the JSON response should strictly adhere to RFC8259 compliance, without any deviations or errors. The JSON structure should match this template:
        "description": "",
        "title": "",
        "paragraph1": "",
        "paragraph2": "",
        "paragraph3": "",
        "paragraph4": "",
        "paragraph5": "",
        "paragraph6": "",
        "paragraph7": ""
      Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies. 
      `;
    }

    let chunks = [];
    let currentChunk = "";
    let currentTokens = 0;
    let allResponses = [];

    for (const word of leagueData.split(" ")) {
      if (currentTokens + word.length < MAX_TOKENS) {
        currentChunk += word + " ";
        currentTokens += word.length + 1;
      } else {
        chunks.push(currentChunk.trim());
        currentChunk = word + " ";
        currentTokens = word.length + 1;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    for (const chunk of chunks) {
      try {
        const filledPrompt = promptTemplate.replace("__LEAGUE_DATA__", chunk);
        const text = await withTimeout(callOpenAI(filledPrompt, "gpt-4o"), 45000);
        let responseData = JSON.parse(text);
        if (!Array.isArray(responseData)) {
          responseData = [responseData];
        }
        allResponses.push(...responseData);
      } catch (chunkError) {
        // A slow/failed chunk shouldn't hang the whole request until Vercel
        // kills it - stop and use whatever chunks did complete.
        console.error("Error generating preview chunk:", chunkError);
        break;
      }
    }

    if (allResponses.length === 0) {
      return res.status(503).json({ error: "Failed to generate preview" });
    }

    // The client (and the cache-hit path above) both expect a single
    // article object, not an array - almost every league only ever
    // produces one chunk anyway.
    const preview = allResponses[0];
    await updateWeeklyInfo(existingDoc, REACT_APP_LEAGUE_ID, preview, currentWeek);
    return res.status(200).json(preview);
  } catch (error) {
    console.error("Unexpected error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred" });
    }
  }
}
