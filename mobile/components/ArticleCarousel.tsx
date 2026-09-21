import { useEffect, useState } from "react";
import { View, Text, Image, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { collection, query, where, getDocs } from "firebase/firestore/lite";
import { db } from "../lib/firebase";
import { firestoreCollections } from "../lib/api";

const weeklyPreviewImg = require("../assets/images/weekly_preview.jpg");
const weeklyRecapImg = require("../assets/images/week_recap.png");
const predictionsImg = require("../assets/images/predictions.jpg");

interface ArticleItem {
  id: number;
  title: string;
  image: any;
  description: string;
  timeAgo: string;
}

const DEFAULT_ARTICLES: ArticleItem[] = [
  {
    id: 1,
    title: "Weekly Preview",
    image: weeklyPreviewImg,
    description: "Our top picks for the upcoming week.",
    timeAgo: "1 day ago",
  },
  {
    id: 2,
    title: "Weekly Recap",
    image: weeklyRecapImg,
    description: "Highlights from the past week.",
    timeAgo: "2 days ago",
  },
  {
    id: 3,
    title: "Predictions",
    image: predictionsImg,
    description: "Our predictions for the next games.",
    timeAgo: "3 days ago",
  },
];

function calculateTimeAgo(dateString?: string) {
  if (!dateString) return "Recently";
  const diffInMs = Date.now() - new Date(dateString).getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes !== 1 ? "s" : ""} ago`;
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours !== 1 ? "s" : ""} ago`;
  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "1 day ago";
  return `${diffInDays} days ago`;
}

export default function ArticleCarousel({ leagueID }: { leagueID: string }) {
  const [articles, setArticles] = useState<ArticleItem[]>(DEFAULT_ARTICLES);
  const router = useRouter();

  useEffect(() => {
    if (!leagueID) return;
    (async () => {
      try {
        const ref = collection(db, firestoreCollections.weeklyArticles);
        const snap = await getDocs(query(ref, where("league_id", "==", leagueID)));
        if (snap.empty) return;

        const docData = snap.docs[0].data();
        const timeAgo = calculateTimeAgo(docData.date);
        setArticles([
          {
            id: 1,
            title: docData.welcome?.title || "Welcome",
            image: DEFAULT_ARTICLES[0].image,
            description: docData.welcome?.description || DEFAULT_ARTICLES[0].description,
            timeAgo,
          },
          {
            id: 2,
            title: docData.playoff_predictions?.title || "Predictions",
            image: predictionsImg,
            description:
              docData.playoff_predictions?.description ||
              "Our predictions and way too early power rankings.",
            timeAgo,
          },
          {
            id: 3,
            title: docData.preview?.title || "Weekly Preview",
            image: weeklyPreviewImg,
            description: docData.preview?.description || "Our top picks for the upcoming week.",
            timeAgo,
          },
        ]);
      } catch (error) {
        console.error("Error fetching articles:", error);
      }
    })();
  }, [leagueID]);

  return (
    <View className="w-full">
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-[17px] font-bold text-white">Featured Stories</Text>
        <Pressable onPress={() => router.push(`/league/${leagueID}/articles`)}>
          <Text className="text-brand text-[12px] font-semibold">See all</Text>
        </Pressable>
      </View>
      {/* Fox Sports style: image at a normal size, full un-truncated
          headline in plain text beside/below it (not overlaid) - the cover
          art is a tall 828x1380 poster with its own baked-in graphic, so it
          sits as a proportionate thumbnail rather than a cropped banner. */}
      <View className="px-4 gap-3">
        {articles.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/league/${leagueID}/articles`)}
            className="flex-row bg-[#141416] border border-white/10 rounded-2xl overflow-hidden"
          >
            <Image
              source={item.image}
              style={{ width: 92, aspectRatio: 828 / 1380 }}
              resizeMode="cover"
            />
            <View className="flex-1 p-3 justify-center">
              <Text className="text-[#e45263] text-[9px] font-bold uppercase tracking-wide mb-1">
                {item.timeAgo}
              </Text>
              <Text className="text-white text-[14px] font-bold leading-[19px] mb-1">{item.title}</Text>
              <Text numberOfLines={3} className="text-gray-400 text-[12px] leading-[17px]">
                {item.description}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
