import { useEffect, useState } from "react";
import { View, Text, Image, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Slot, useLocalSearchParams, useRouter, usePathname } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { sleeper } from "../../../lib/api";
import { storage, StorageKeys } from "../../../lib/storage";
import { onAuthChange, isReadOnly } from "../../../lib/socialAuth";
import { getUnreadNotificationCount } from "../../../lib/notifications";
import { getUnreadConversationCount } from "../../../lib/messages";
import Scoreboard from "../../../components/Scoreboard";
import BottomTabBar from "../../../components/BottomTabBar";
import { PlayerDetailProvider } from "../../../components/PlayerDetailProvider";

const helmet = require("../../../assets/images/helmet2.png");
// Persists across navigation within a league (this masthead never
// unmounts, Slot swaps underneath it), so unread counts are refreshed on
// a timer rather than only once on mount.
const UNREAD_POLL_MS = 20000;

function IconBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-brand items-center justify-center border border-[#0c0c0e]">
      <Text className="text-white text-[9px] font-bold">{count > 9 ? "9+" : count}</Text>
    </View>
  );
}

export default function LeagueLayout() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const [leagueName, setLeagueName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!leagueID) return;
    (async () => {
      const storedName = await storage.getItem(StorageKeys.selectedLeagueName);
      if (storedName) setLeagueName(storedName);
      try {
        const res = await sleeper.getLeague(leagueID);
        setAvatar(res.data?.avatar ?? null);
        if (!storedName && res.data?.name) setLeagueName(res.data.name);
      } catch (error) {
        console.error("Error fetching league info:", error);
      }
    })();
  }, [leagueID]);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setUnreadNotifs(0);
      setUnreadMessages(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      getUnreadNotificationCount(authUser.uid).then((n) => !cancelled && setUnreadNotifs(n)).catch(console.error);
      getUnreadConversationCount(authUser.uid).then((n) => !cancelled && setUnreadMessages(n)).catch(console.error);
    };
    refresh();
    const interval = setInterval(refresh, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authUser]);

  if (!leagueID) return null;

  // The bottom tab bar's own 5 destinations are "root" screens within a
  // league - everything else (Draft Recap, Schedule, a matchup, Trades,
  // anything opened from the More menu...) is a deeper page that has no
  // other way back short of the OS's own swipe/back gesture, which isn't
  // discoverable on every device. Rather than adding a header to every one
  // of those screens individually, this masthead - the one thing that's
  // actually present on all of them - grows a back arrow in its left slot
  // whenever the current screen isn't one of the 5 roots.
  const isRootTab =
    pathname === `/league/${leagueID}` ||
    pathname.endsWith("/standings") ||
    pathname.endsWith("/powerrankings") ||
    pathname.endsWith("/more");

  return (
    <PlayerDetailProvider leagueID={leagueID}>
    <SafeAreaView className="flex-1 bg-[#0c0c0e]" edges={["top"]}>
      {/* Dark masthead so it reads as one cohesive unit with the
          scoreboard strip directly beneath it, instead of a mismatched
          light bar sitting on top of a dark one. Notifications/Messages
          icons sit here (not buried in a per-screen header) since this
          masthead is the one thing visible on every screen in a league. */}
      <View className="flex-row items-center justify-between px-3 py-2.5 bg-[#0c0c0e] border-b border-white/10">
        <View className="w-[76px]">
          {!isRootTab && (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.push(`/league/${leagueID}`))}
              hitSlop={10}
              className="p-2 -ml-2 self-start"
            >
              <Feather name="arrow-left" size={20} color="#e5e7eb" />
            </Pressable>
          )}
        </View>
        <View className="items-center flex-1">
          <Image
            source={avatar ? { uri: `https://sleepercdn.com/avatars/thumbs/${avatar}` } : helmet}
            className="w-[40px] h-[40px] rounded-full mb-1 border border-white/10"
          />
          <Text className="text-[15px] font-bold text-white">{leagueName}</Text>
        </View>
        <View className="w-[76px] flex-row items-center justify-end gap-1">
          <Pressable onPress={() => router.push("/notifications")} hitSlop={8} className="p-2">
            <Feather name="bell" size={19} color="#e5e7eb" />
            <IconBadge count={unreadNotifs} />
          </Pressable>
          <Pressable onPress={() => router.push("/messages")} hitSlop={8} className="p-2">
            <Feather name="mail" size={19} color="#e5e7eb" />
            <IconBadge count={unreadMessages} />
          </Pressable>
        </View>
      </View>
      <Scoreboard leagueID={leagueID} />
      <View className="flex-1">
        <Slot />
      </View>
      <BottomTabBar leagueID={leagueID} />
    </SafeAreaView>
    </PlayerDetailProvider>
  );
}
