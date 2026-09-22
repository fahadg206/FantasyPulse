import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { storage } from "../../../lib/storage";
import { LOTTERY_LEAGUE_IDS } from "../../../lib/draftLottery";

type MenuItem = {
  label: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  params?: Record<string, string>;
};

export default function More() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  if (!leagueID) return null;

  const items: MenuItem[] = [
    {
      label: "Feed",
      description: "What's happening in this league - post, reply, like",
      icon: <Feather name="message-circle" size={20} color="#af1222" />,
      path: `/feed`,
      params: { leagueID },
    },
    {
      label: "Messages",
      description: "Direct messages with other managers",
      icon: <Feather name="mail" size={20} color="#af1222" />,
      path: `/messages`,
    },
    {
      label: "Notifications",
      description: "Replies, likes, reposts, and new followers",
      icon: <Feather name="bell" size={20} color="#af1222" />,
      path: `/notifications`,
    },
    {
      label: "Fantasy Profile",
      description: "Your stats across every league, and managers you follow",
      icon: <Ionicons name="person-circle" size={20} color="#af1222" />,
      path: `/profile`,
    },
    {
      label: "League Managers",
      description: "Browse rosters and weekly results by manager",
      icon: <Ionicons name="people" size={20} color="#af1222" />,
      path: `/league/${leagueID}/leaguemanagers`,
    },
    {
      label: "Power Rankings",
      description: "Every team ranked and sorted into tiers",
      icon: <Ionicons name="trophy" size={20} color="#af1222" />,
      path: `/league/${leagueID}/powerrankings`,
    },
    {
      label: "Trades",
      description: "Every trade this season - tap one to comment",
      icon: <Feather name="repeat" size={20} color="#af1222" />,
      path: `/league/${leagueID}/trades`,
    },
    {
      label: "Rivalry",
      description: "Head-to-head history between two managers",
      icon: <Ionicons name="pulse" size={20} color="#af1222" />,
      path: `/league/${leagueID}/rivalry`,
    },
    {
      label: "Trade Calculator",
      description: "Check if a trade is fair before you make it",
      icon: <Feather name="repeat" size={20} color="#af1222" />,
      path: `/league/${leagueID}/tradecalculator`,
    },
    {
      label: "Draft Recap",
      description: "Grades, picks, and summaries from your draft",
      icon: <Feather name="clipboard" size={20} color="#af1222" />,
      path: `/league/${leagueID}/draft`,
    },
    ...(LOTTERY_LEAGUE_IDS.has(leagueID)
      ? [
          {
            label: "Draft Lottery",
            description: "Lottery odds if the season ended today, plus next year's early rookie board",
            icon: <Ionicons name="shuffle" size={20} color="#af1222" />,
            path: `/league/${leagueID}/lottery`,
          },
        ]
      : []),
    {
      label: "About Fantasy Pulse",
      description: "What we do, and frequently asked questions",
      icon: <Feather name="info" size={20} color="#af1222" />,
      path: `/league/${leagueID}/about`,
    },
    {
      label: "Report an Issue",
      description: "Something broken or missing? Let us know",
      icon: <Feather name="flag" size={20} color="#af1222" />,
      path: `/league/${leagueID}/report`,
    },
  ];

  const logOut = async () => {
    await storage.clearLeagueSelection();
    router.replace("/");
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="p-4">
      <View className="rounded-2xl border border-brand/15 dark:border-white/10 overflow-hidden">
        {items.map((item, i) => (
          <Pressable
            key={item.path}
            onPress={() => router.push((item.params ? { pathname: item.path, params: item.params } : item.path) as any)}
            className={`flex-row items-center gap-3 px-4 py-4 bg-white dark:bg-[#151010] ${
              i !== items.length - 1 ? "border-b border-brand/10 dark:border-white/10" : ""
            }`}
          >
            <View className="w-9 h-9 rounded-full bg-brand/10 items-center justify-center">
              {item.icon}
            </View>
            <View className="flex-1">
              <Text className="font-semibold text-black dark:text-white">{item.label}</Text>
              <Text className="text-[12px] text-gray-500 mt-0.5">{item.description}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#a0a0a0" />
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={logOut}
        className="flex-row items-center justify-center gap-2 mt-6 py-3 rounded-2xl border border-brand"
      >
        <Feather name="log-out" size={18} color="#af1222" />
        <Text className="text-brand font-semibold">Back to Login</Text>
      </Pressable>
    </ScrollView>
  );
}
