import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AntDesign } from "@expo/vector-icons";
import { collection, query, where, getDocs, addDoc } from "firebase/firestore/lite";
import { db } from "../../../lib/firebase";
import { APP_ORIGIN, backend, sleeper, firestoreCollections } from "../../../lib/api";
import ArticleTemplate from "../../../components/ArticleTemplate";
import ArticlePicker from "../../../components/ArticlePicker";
import ArticleProgressSpinner from "../../../components/ArticleProgressSpinner";
import ShowAuthors from "../../../components/ShowAuthors";
import { generatePreviewArticle } from "../../../lib/generatePreviewArticle";
import { generatePowerRankings } from "../../../lib/generatePowerRankings";

const fahad = require("../../../assets/images/fahad.jpg");
const hamsa = require("../../../assets/images/hamsa.png");
const boogie = require("../../../assets/images/boogie.png");
const welcomeImg = require("../../../assets/images/welcome_season2.jpg");
const predictionsImg = require("../../../assets/images/predictions.jpg");
const previewImg = require("../../../assets/images/weekly_preview.jpg");

type Article = { title: string; [key: string]: any } | null;

function getFormattedDate(d: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const amOrPm = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hours12}:${minutes < 10 ? "0" : ""}${minutes} ${amOrPm} EST`;
}

function withClientTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Client timeout")), ms)),
  ]);
}

// Gives the backend a limited window before giving up - the AI endpoints
// can hang far longer than any reasonable UI should wait, so this fails
// fast and lets the caller fall back to a locally generated article
// instead of leaving the screen stuck loading.
async function fetchFromApi(endpoint: string, leagueId: string) {
  try {
    const res = await withClientTimeout(
      fetch(`${APP_ORIGIN}/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      }),
      12000
    );
    if (!res.ok) throw new Error("Failed to fetch data");
    return await res.json();
  } catch (error) {
    // Expected and already handled by the local-article fallback below -
    // console.error would pop Expo's red LogBox screen for a case that
    // isn't actually broken, so this stays at log level.
    console.log(`${endpoint} didn't respond in time, falling back to a local article:`, error);
    return null;
  }
}

export default function Articles() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [welcomeArticle, setWelcomeArticle] = useState<Article>(null);
  const [playoffsArticle, setPlayoffsArticle] = useState<Article>(null);
  const [previewArticle, setPreviewArticle] = useState<Article>(null);
  const [selected, setSelected] = useState("welcome");

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const ref = collection(db, firestoreCollections.weeklyArticles);
        const snap = await getDocs(query(ref, where("league_id", "==", leagueID)));

        let docData: any = {};
        if (!snap.empty) {
          docData = snap.docs[0].data();
        } else {
          await addDoc(ref, { league_id: leagueID, date: getFormattedDate(new Date()) });
        }
        if (cancelled) return;

        // Paint whatever's cached immediately instead of blocking the
        // spinner on a network round-trip - each backend endpoint now only
        // regenerates its content once the NFL week rolls over, so calling
        // all three below is cheap (a Firestore read) on every visit except
        // the first one of the week.
        setDate(docData.date || getFormattedDate(new Date()));
        if (docData.welcome) setWelcomeArticle(docData.welcome);
        if (docData.playoff_predictions) setPlayoffsArticle(docData.playoff_predictions);
        if (docData.preview) setPreviewArticle(docData.preview);
        setLoading(!docData.welcome && !docData.playoff_predictions && !docData.preview);

        const { data: nflState } = await sleeper.getNflState();
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const playersData = await backend.fetchPlayers(leagueID);

        const [welcome, playoffs, preview] = await Promise.all([
          fetchFromApi("fetchWelcome", leagueID),
          fetchFromApi("fetchPlayoffPredictions", leagueID),
          fetchFromApi("fetchPreview", leagueID),
        ]);
        if (cancelled) return;

        // The AI-written versions win when they answer in time; otherwise
        // fall back to an article built locally from real league data
        // instead of leaving the page blank or stuck loading forever.
        const [resolvedPlayoffs, resolvedPreview] = await Promise.all([
          playoffs ?? generatePowerRankings(leagueID).catch((e) => {
            console.error("Error generating local power rankings:", e);
            return null;
          }),
          preview ?? generatePreviewArticle(leagueID, week, playersData).catch((e) => {
            console.error("Error generating local preview:", e);
            return null;
          }),
        ]);

        if (!cancelled) {
          if (welcome) setWelcomeArticle(welcome);
          if (resolvedPlayoffs) setPlayoffsArticle(resolvedPlayoffs);
          if (resolvedPreview) setPreviewArticle(resolvedPreview);
          setLoading(false);
        }
      } catch (error) {
        console.error("Error:", error);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center p-4 bg-[#0c0c0e]">
        <View className="flex-row items-center flex-wrap justify-center mb-4">
          <AntDesign name="warning" size={22} color="#af1222" />
          <Text className="font-bold text-center mx-2 text-white">
            PLEASE DO NOT REFRESH AS IT CAN HINDER ARTICLE RESULTS!!
          </Text>
          <AntDesign name="warning" size={22} color="#af1222" />
        </View>
        <ArticleProgressSpinner />
      </View>
    );
  }

  const options = [
    { key: "welcome", label: welcomeArticle?.title || "Welcome" },
    { key: "playoffs", label: playoffsArticle?.title || "Predictions" },
    { key: "preview", label: previewArticle?.title || "Preview" },
  ];

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center gap-2.5 px-4 py-3 border-b border-white/10">
        <View className="flex-1 items-start">
          <ArticlePicker options={options} selected={selected} onSelect={setSelected} />
        </View>
        <ShowAuthors compact />
      </View>

      {selected === "welcome" && (
        <ArticleTemplate
          category="Welcome"
          title={welcomeArticle?.title || ""}
          image={welcomeImg}
          author="Fahad Guled"
          authorImg={fahad}
          jobtitle="Fantasy Pulse Co-Founder"
          date={date}
          article={welcomeArticle}
        />
      )}
      {selected === "playoffs" && (
        <ArticleTemplate
          category="Predictions"
          title={playoffsArticle?.title || ""}
          image={predictionsImg}
          author="El Jefe"
          authorImg={hamsa}
          jobtitle="Head of Media Department"
          date={date}
          article={playoffsArticle}
        />
      )}
      {selected === "preview" && (
        <ArticleTemplate
          category="Weekly Preview"
          title={previewArticle?.title || ""}
          image={previewImg}
          author="Boogie The Writer"
          authorImg={boogie}
          jobtitle="Fantasy Pulse Senior Staff Writer"
          date={date}
          article={previewArticle}
        />
      )}
    </View>
  );
}
