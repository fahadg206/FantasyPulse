import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
} from "firebase/firestore/lite";
import dotenv from "dotenv";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";
import { db, storage } from "../../app/firebase";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

const generateSummaries = async (draftData) => {
  const model = new ChatOpenAI({
    temperature: 0.9,
    model: "gpt-4-turbo",
    openAIApiKey: OPENAI_API_KEY,
  });

  const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);
  const chain = new LLMChain({ llm: model, prompt });

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

  const summaries = [];
  for (const chunk of draftDataChunks) {
    let apiResponse;
    try {
      apiResponse = await chain.call({
        draftData: JSON.stringify(chunk),
      });
      console.log("API response text:", apiResponse.text);

      // Check and clean the response text
      let cleanText = apiResponse.text.trim();
      // Remove potential backticks and unexpected characters
      cleanText = cleanText.replace(/[`]/g, '"');

      const parsedResponse = JSON.parse(cleanText);
      summaries.push(...parsedResponse);
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error(
        "Response text that caused the error:",
        apiResponse ? apiResponse.text : "No response"
      );
    }
  }

  return summaries;
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
