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

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Vercel's default serverless function duration is too short for a GPT-4
// chain call - without this the function gets killed mid-request and the
// client sees a 504 regardless of whether the OpenAI call would have
// eventually succeeded.
export const config = { maxDuration: 60 };

const updateWeeklyInfo = async (REACT_APP_LEAGUE_ID, articles) => {
  articles = await JSON.parse(articles);
  const weeklyInfoCollectionRef = collection(db, "Weekly Articles");
  const queryRef = query(
    weeklyInfoCollectionRef,
    where("league_id", "==", REACT_APP_LEAGUE_ID)
  );
  const querySnapshot = await getDocs(queryRef);
  if (!querySnapshot.empty) {
    querySnapshot.forEach(async (doc) => {
      await updateDoc(doc.ref, {
        playoff_predictions: articles,
      });
    });
  } else {
    await addDoc(weeklyInfoCollectionRef, {
      league_id: REACT_APP_LEAGUE_ID,
      playoff_predictions: articles,
    });
  }
};

export default async function handler(req, res) {
  const REACT_APP_LEAGUE_ID = req.body;
  const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}_preview.txt`);
  const url = await getDownloadURL(readingRef);

  const response = await fetch(url);
  const fileContent = await response.text();
  const leagueData = JSON.stringify(fileContent).replace(/\//g, "");

  try {
    const model = new ChatOpenAI({
      temperature: 0.9,
      model: "gpt-4-turbo",
      openAIApiKey: OPENAI_API_KEY,
    });

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
      Here is the league data: {leagueData}
    `;

    const prompt = new PromptTemplate({
      template: basePrompt,
      inputVariables: ["leagueData"],
    });

    const chainA = new LLMChain({ llm: model, prompt });

    // Properly pass the `leagueData` variable into the LLMChain
    const apiResponse = await chainA.call({ leagueData });

    // Save data to the database
    await updateWeeklyInfo(REACT_APP_LEAGUE_ID, apiResponse.text);
    // Process the response and send it as JSON
    return res.status(200).json(JSON.parse(apiResponse.text));
  } catch (error) {
    console.error("Unexpected error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred" });
    }
  }
}
