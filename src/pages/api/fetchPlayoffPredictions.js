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
        playoff_predictions: articles,
      });
    });
  } else {
    // Document does not exist, add a new one
    await addDoc(weeklyInfoCollectionRef, {
      league_id: REACT_APP_LEAGUE_ID,
      playoff_predictions: articles,
    });
  }
};

export default async function handler(req, res) {
  //console.log("here");
  // console.log("what was passed in ", req.body);
  const REACT_APP_LEAGUE_ID = req.body;
  const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}_preview.txt`);
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

    const question = `{leagueData} It is the first game of the season and there hasn't been a single game played yet. Give me an exciting "way too early" power rankings on the league data I provided you provide some analysis of their teams, Make sure to include all teams only once, there should be no duplicate teams in the response. Include each teams percentage chance for making the playoffs. Include your prediction for what their record would be out of 14 games. THE PLAYOFF CHANCES SHOULD BE DISPLAYED OUT OF A HUNDRED ALONG SIDE RECORD. Article should be titled "WAY TOO EARLY POWER RANKINGS". The JSON structure should match this template:
    "title": "",
    "paragraph1": "",
    "paragraph2": "",
    "paragraph3": "",
    "paragraph4": "",
    "paragraph5": "",
    "paragraph6": "",
    "paragraph7": ""
    USE however many MORE paragraphs necessary to complete the response and include ALL teams. Make sure ALL THE TEAMS IN THE league ARE LISTED in your response. DON'T FORGET NO DUPLICATE TEAMS. Please ensure that the generated JSON response meets the specified criteria without any syntax issues or inconsistencies.`;

    const prompt = PromptTemplate.fromTemplate(question);
    const chainA = new LLMChain({ llm: model, prompt });
    const apiResponse = await chainA.call({ leagueData: newFile });

    //console.log("Headlines API ", apiResponse.text);
    // const cleanUp = await model.call([
    //   new SystemMessage(
    //     "Turn the following string into valid JSON format that strictly adhere to RFC8259 compliance, if it already is in a valid JSON format then give me the string as the response, without any other information from you"
    //   ),
    //   new HumanMessage(apiResponse.text),
    // ]);

    //updateWeeklyInfo(REACT_APP_LEAGUE_ID, cleanUp.content);

    return res.status(200).json(JSON.parse(apiResponse.text));
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
      console.log("No documents found in 'Article Info' collection");
      return res.status(404).json({ error: "No documents found" });
    }
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
}
