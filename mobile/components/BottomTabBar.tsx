import { View, Text, Pressable } from "react-native";
import { useRouter, usePathname, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";

type TabDef = {
  href: string;
  label: string;
  icon: (color: string) => React.ReactNode;
  match: (pathname: string) => boolean;
};

export default function BottomTabBar({ leagueID }: { leagueID: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const tabs: TabDef[] = [
    {
      href: `/league/${leagueID}`,
      label: "Home",
      icon: (color) => <Ionicons name="home" size={22} color={color} />,
      match: (p) => p === `/league/${leagueID}`,
    },
    {
      href: `/league/${leagueID}/standings`,
      label: "Standings",
      icon: (color) => <Ionicons name="list" size={22} color={color} />,
      match: (p) => p.endsWith("/standings"),
    },
    {
      href: `/feed?leagueID=${leagueID}`,
      label: "Feed",
      icon: (color) => <Feather name="activity" size={22} color={color} />,
      match: (p) => p === "/feed",
    },
    {
      href: `/league/${leagueID}/powerrankings`,
      label: "Rankings",
      icon: (color) => <Ionicons name="trophy" size={22} color={color} />,
      match: (p) => p.endsWith("/powerrankings"),
    },
    {
      href: `/league/${leagueID}/more`,
      label: "More",
      icon: (color) => <Feather name="menu" size={22} color={color} />,
      match: (p) => p.endsWith("/more"),
    },
  ];

  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      className="flex-row items-stretch border-t border-brand/20 bg-white dark:bg-black"
    >
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        const color = active ? "#af1222" : "#807c7c";
        return (
          <Pressable
            key={tab.href}
            onPress={() => router.push(tab.href as Href)}
            hitSlop={6}
            className="flex-1 items-center justify-center gap-0.5 py-2.5 min-h-[52px]"
          >
            {tab.icon(color)}
            <Text style={{ color }} className="text-[10px]">
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
