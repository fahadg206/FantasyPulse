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

export default async function handler(req, res) {
  //console.log("here");
  // console.log("what was passed in ", req.body);
  const REACT_APP_LEAGUE_ID = req.body;
  const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}.txt`);
  const url = await getDownloadURL(readingRef);

  const response = await fetch(url);
  const fileContent = await response.text();
  const newFile = JSON.stringify(fileContent).replace(/\//g, "");

  try {
    //console.log("Here");
    //console.info(process.env.OPENAI_API_KEY);
    const model = new ChatOpenAI({
      temperature: 0.9,
      model: "gpt-4",
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const question = `{leagueData} give me 3 creative and funny sports style headlines recapping this weeks matchups, pick any 3 matchups to cover and make title's creative and exciting. include their star players on their team who scored the most points for them, their win-loss record , streak if it's notable and who won by comparing their team points vs their opponents team points in that specific matchup, who ever had more team points in that matchup won the game, please ensure accuracy when stating who won and who lost. include a bit of humor and be creative with the titles and descriptions. I want the information to be in this format exactly headline: 
  "id": "",
  "category": "",
  "title": "",
  "description": ""
 keep response concise and exciting. give me the response in valid JSON array format. Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies.`;
    //console.log(question);

    const prompt = PromptTemplate.fromTemplate(question);
    const chainA = new LLMChain({ llm: model, prompt });

    // The result is an object with a `text` property.
    const apiResponse = await chainA.call({ leagueData: newFile });
    // const cleanUp = await model.call([
    //   new SystemMessage(
    //     "Turn the following string into valid JSON format that strictly adhere to RFC8259 compliance"
    //   ),
    //   new HumanMessage(apiResponse.text),
    // ]);
    // console.log("Headlines API ", apiResponse.text);
    // const cleanUp = await model.call([
    //   new SystemMessage(
    //     "Turn the following string into valid JSON format that strictly adhere to RFC8259 compliance, if it already is in a valid JSON format then give me the string as the response, without any other information from you"
    //   ),
    //   new HumanMessage(apiResponse.text),
    // ]);

    updateWeeklyInfo(REACT_APP_LEAGUE_ID, apiResponse.text);
    //console.log(apiResponse.text);

    return res.status(200).json(JSON.parse(apiResponse.text));
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Failed" });
  }
}
