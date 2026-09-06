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

// Vercel's default serverless function duration is too short for the
// multiple chained GPT-4 calls this can make (one per draft-data chunk) -
// without this the function gets killed mid-request and the client sees a
// 504/timeout regardless of whether the calls would have eventually
// succeeded.
export const config = { maxDuration: 60 };

const PROMPT_TEMPLATE = `Given the draft data: {draftData}, generate a creative and funny summary of how the draft went for each fantasy manager. Make sure to include ALL fantasy managers.
      The summary should include in any order:
      - Key picks, highlighting their best picks and what round they took them in, and critiquing their worst picks in a funny and humorous way.
      - Their fantasy football draft strategy and team building and any other trends you might've noticed like the positions they selected to create that.
      - Fun facts or humorous observations about their draft or about their team or team name, make this funny, unique, creative and entertaining.
      
      Provide the response in the following JSON format for each user:
      
          "id": "<User's ID>",
          "category": "Summary",
          "title": "<User's name> Summary",
          "description": "<An exciting, humorous, sports style and entertaining summary that isn't too boiler plate, get creative!>"
      
      Ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies. Make sure to include ALL fantasy managers. Provide the response in a valid JSON array format.`;

// Races a chunk's OpenAI call against a deadline safely inside Vercel's own
// maxDuration, so a slow completion is skipped instead of consuming the
// whole request's time budget until the function gets hard-killed.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms)),
  ]);
}

const generateSummaries = async (draftData) => {
  const CHUNK_SIZE = 5000; // Adjust this value based on the actual prompt size limit

  const draftDataChunks = [];
  let currentChunk = [];
  let currentChunkSize = 0;

  for (const data of draftData) {
    const dataString = JSON.stringify(data);
    const dataLength = dataString.length;

    if (currentChunkSize + dataLength < CHUNK_SIZE) {
      currentChunk.push(data);
      currentChunkSize += dataLength;
    } else {
      draftDataChunks.push(currentChunk);
      currentChunk = [data];
      currentChunkSize = dataLength;
    }
  }

  if (currentChunk.length > 0) {
    draftDataChunks.push(currentChunk);
  }

  // Chunks are independent (each covers a disjoint slice of managers), so
  // they can run concurrently instead of one-at-a-time - this matters once
  // a league is large enough to need more than one chunk.
  const chunkResults = await Promise.all(
    draftDataChunks.map(async (chunk) => {
      let text;
      try {
        const promptText = PROMPT_TEMPLATE.replace("{draftData}", JSON.stringify(chunk));
        text = await withTimeout(callOpenAI(promptText, "gpt-4o"), 45000);
        const cleanText = text.trim().replace(/[`]/g, '"');
        return JSON.parse(cleanText);
      } catch (error) {
        console.error("Error parsing response:", error);
        console.error("Response text that caused the error:", text ?? "No response");
        return [];
      }
    })
  );

  return chunkResults.flat();
};

const updateSummariesInDB = async (REACT_APP_LEAGUE_ID, summaries) => {
  const summariesCollectionRef = collection(db, "Draft Summaries");
  const queryRef = query(
    summariesCollectionRef,
    where("league_id", "==", REACT_APP_LEAGUE_ID)
  );
  const querySnapshot = await getDocs(queryRef);
  if (!querySnapshot.empty) {
    querySnapshot.forEach(async (doc) => {
      await updateDoc(doc.ref, { summaries });
    });
  } else {
    await addDoc(summariesCollectionRef, {
      league_id: REACT_APP_LEAGUE_ID,
      summaries,
    });
  }
};

export default async function handler(req, res) {
  const { REACT_APP_LEAGUE_ID, scoring_type, draftData } = req.body;

  const summariesCollectionRef = collection(db, "Draft Summaries");
  const queryRef = query(
    summariesCollectionRef,
    where("league_id", "==", REACT_APP_LEAGUE_ID)
  );

  try {
    await authReady;
    const querySnapshot = await getDocs(queryRef);
    if (!querySnapshot.empty) {
      const summariesDoc = querySnapshot.docs[0];
      return res.status(200).json(summariesDoc.data().summaries);
    }

    const summaries = await generateSummaries(draftData);
    await updateSummariesInDB(REACT_APP_LEAGUE_ID, summaries);
    return res.status(200).json(summaries);
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Failed to generate summaries" });
  }
}
