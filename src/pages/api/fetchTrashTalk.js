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
import { articles } from "./articles";

import { QuerySnapshot, onSnapshot } from "firebase/firestore";
import dotenv from "dotenv";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { JSONLoader } from "langchain/document_loaders";
import { FaissStore } from "langchain/vectorstores/faiss";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { SystemMessage } from "langchain/schema";
import { HumanMessage } from "langchain/schema";
import { RetrievalQAChain } from "langchain/chains";
import fs from "fs";
import path from "path";
import { db, storage } from "../../app/firebase";

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const updateWeeklyInfo = async (REACT_APP_LEAGUE_ID, articles) => {
  articles = await JSON.parse(articles);
  // Reference to the "Weekly Info" collection
  const weeklyInfoCollectionRef = collection(db, "Weekly Articles");
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
        trash_talk: articles,
      });
    });
  } else {
    // Document does not exist, add a new one
    await addDoc(weeklyInfoCollectionRef, {
      league_id: REACT_APP_LEAGUE_ID,
      trash_talk: articles,
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

    const question = `Using the league data I provided you Write a short article about The Art of Trash Talk: Showcase the best and wittiest trash talk exchanges between managers, celebrating the creativity and competitiveness within the league. make up fake quotes if you need to. Pick one random matchup
 Keep the content within 150 words maximum. The format of the JSON response should strictly adhere to RFC8259 compliance, without any deviations or errors. The JSON structure should match this template:
  "title": "",
  "paragraph1": "",
  "paragraph2": "",
  "paragraph3": "",
  "paragraph4": "",
  "paragraph5": "",
  "paragraph6": "",
  "paragraph7": ""
Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies. {leagueData} `;

    const prompt = PromptTemplate.fromTemplate(question);
    const chainA = new LLMChain({ llm: model, prompt });
    const apiResponse = await chainA.call({ leagueData: newFile });

    //console.log("Headlines API ", apiResponse.text);
    const cleanUp = await model.call([
      new SystemMessage(
        "Turn the following string into valid JSON format that strictly adhere to RFC8259 compliance, if it already is in a valid JSON format then give me the string as the response, without any other information from you"
      ),
      new HumanMessage(apiResponse.text),
    ]);

    updateWeeklyInfo(REACT_APP_LEAGUE_ID, cleanUp.content);

    return res.status(200).json(JSON.parse(cleanUp.content));
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "An error occurred" });
  }

  try {
    // Retrieve data from the database based on league_id
    const querySnapshot = await getDocs(
      query(
        collection(db, "Weekly Info"),
        where("league_id", "==", REACT_APP_LEAGUE_ID),
        limit(1)
      )
    );

    if (!querySnapshot.empty) {
      //console.log("No documents found in 'Article Info' collection");
      return res.status(404).json({ error: "No documents found" });
    }
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
}
