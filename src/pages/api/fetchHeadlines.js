import { ref, getDownloadURL } from "firebase/storage";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
} from "firebase/firestore/lite";
import { Document } from "langchain/document";
import dotenv from "dotenv";
import { FaissStore } from "langchain/vectorstores/faiss";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { RetrievalQAChain } from "langchain/chains";
import { SystemMessage } from "langchain/schema";
import { HumanMessage } from "langchain/schema";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";

import { db, storage } from "../../app/firebase";

//dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Vercel's default serverless function duration is too short for a GPT-4
// chain call - without this the function gets killed mid-request and the
// client sees a 504 regardless of whether the OpenAI call would have
// eventually succeeded.
export const config = { maxDuration: 60 };

const updateWeeklyInfo = async (REACT_APP_LEAGUE_ID, headlines) => {
  headlines = JSON.parse(headlines);
  // Reference to the "Weekly Info" collection
  const weeklyInfoCollectionRef = collection(db, "Weekly Headlines");
  // Use a Query to check if a document with the league_id exists
  const queryRef = query(
    weeklyInfoCollectionRef,
    where("league_id", "==", REACT_APP_LEAGUE_ID)
  );
  const querySnapshot = await getDocs(queryRef);
  // Add or update the document based on whether it already exists
  if (!querySnapshot.empty) {
    // Document exists, update it
    //console.log("in if");
    querySnapshot.forEach(async (doc) => {
      await updateDoc(doc.ref, {
        headlines: headlines,
      });
    });
  } else {
    // Document does not exist, add a new one
    await addDoc(weeklyInfoCollectionRef, {
      league_id: REACT_APP_LEAGUE_ID,
      headlines: headlines,
    });
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

export default async function handler(req, res) {
  const REACT_APP_LEAGUE_ID = req.body;

  try {
    const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}.txt`);
    const url = await getDownloadURL(readingRef);
    const response = await fetch(url);
    const fileContent = await response.text();
    const newFile = JSON.stringify(fileContent).replace(/\//g, "");

    const model = new ChatOpenAI({
      temperature: 0.9,
      model: "gpt-4o",
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const question = `{leagueData} give me 3 creative exciting and funny sports style headlines previewing this weeks fantasy football matchups, pick any 3 matchups to cover and make title's creative and exciting. Each headline should look like an exciting anticipated sports matchup.
  include the teams, star players and key matchups in the matchup preview, include a bit of humor and be creative with the titles and descriptions. I want the information to be in this format exactly headline:
  "id": "",
  "category": "",
  "title": "",
  "description": ""
 keep response concise and exciting. give me the response in valid JSON array format. Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies.`;

    const prompt = PromptTemplate.fromTemplate(question);
    const chainA = new LLMChain({ llm: model, prompt });

    const apiResponse = await withTimeout(chainA.call({ leagueData: newFile }), 45000);

    return res.status(200).json(JSON.parse(apiResponse.text));
  } catch (error) {
    // Non-2xx so the client's existing default-headlines fallback kicks in
    // and it doesn't cache a failure as if it were real content - see
    // HomeCarousel.tsx, which only caches an array response to Firestore.
    console.error("Unexpected error:", error);
    return res.status(503).json({ error: "Failed to generate headlines" });
  }
}
