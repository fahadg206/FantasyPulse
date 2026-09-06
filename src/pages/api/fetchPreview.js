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
import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";
import { db, storage } from "../../app/firebase";
import { serverTimestamp } from "firebase/firestore/lite";
import { Readable } from "stream";

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_TOKENS = 8192; // GPT-4 turbo token limit

// Vercel's default serverless function duration is too short for a GPT-4
// chain call (or several, when the league data is chunked below) - without
// this the function gets killed mid-request and the client sees a 504.
export const config = { maxDuration: 60 };

const updateWeeklyInfo = async (leagueId, articles) => {
  const weeklyInfoCollectionRef = collection(db, "Weekly Articles");

  const queryRef = query(
    weeklyInfoCollectionRef,
    where("league_id", "==", leagueId)
  );
  const querySnapshot = await getDocs(queryRef);

  const dataToUpdate = {
    preview: articles[0], // Directly using the parsed JSON object
    timestamp: serverTimestamp(),
    type: "preview",
  };

  if (!querySnapshot.empty) {
    querySnapshot.forEach(async (doc) => {
      await updateDoc(doc.ref, dataToUpdate);
    });
  } else {
    await addDoc(weeklyInfoCollectionRef, {
      league_id: leagueId,
      preview: articles,
      timestamp: serverTimestamp(),
      type: "preview",
    });
  }
};

function countTokens(inputString) {
  return inputString.split(/\s+|\b/).filter((word) => word.trim() !== "")
    .length;
}

export default async function handler(req, res) {
  const REACT_APP_LEAGUE_ID = req.body;
  const MAX_TOKENS = 8192;

  try {
    if (!REACT_APP_LEAGUE_ID) {
      return res.status(400).json({ error: "league_id is required" });
    }

    const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}_preview.txt`);
    const url = await getDownloadURL(readingRef);

    const response = await fetch(url);
    const fileContent = await response.text();
    const leagueData = JSON.stringify(fileContent).replace(/\//g, "");
    const tokenCount = countTokens(leagueData);

    const model = new ChatOpenAI({
      temperature: 0.9,
      model: "gpt-4-turbo",
      openAIApiKey: OPENAI_API_KEY,
    });

    let promptTemplate;
    if (tokenCount > MAX_TOKENS) {
      promptTemplate = `
        Here is the league data: {leagueData}
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
        Here is the league data: {leagueData}
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

    const prompt = new PromptTemplate({
      inputVariables: ["leagueData"],
      template: promptTemplate,
    });

    const chainA = new LLMChain({
      llm: model,
      prompt: prompt,
    });

    res.setHeader("Content-Type", "application/json");

    const stream = new Readable({
      read() {}, // Required but not used
    });

    stream.pipe(res);

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

    stream.push("[");
    let firstChunk = true;

    for (const chunk of chunks) {
      const apiResponse = await chainA.call({ leagueData: chunk });
      let responseData;
      try {
        responseData = JSON.parse(apiResponse.text);
        if (!Array.isArray(responseData)) {
          responseData = [responseData];
        }
        allResponses.push(...responseData);

        responseData.forEach((data, index) => {
          if (index > 0 || !firstChunk) stream.push(",");
          stream.push(JSON.stringify(data));
          firstChunk = false;
        });
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        res.status(500).json({ error: "Failed to parse response JSON" });
        return;
      }
    }

    stream.push("]");
    stream.push(null); // End the stream

    await updateWeeklyInfo(REACT_APP_LEAGUE_ID, allResponses);
  } catch (error) {
    console.error("Unexpected error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred" });
    }
  }
}
