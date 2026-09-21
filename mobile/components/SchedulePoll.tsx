import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { MotiView } from "moti";
import { Feather } from "@expo/vector-icons";
import { collection, query, where, getDocs, addDoc, updateDoc, limit } from "firebase/firestore/lite";
import { db } from "../lib/firebase";
import { firestoreCollections } from "../lib/api";
import { storage, StorageKeys } from "../lib/storage";

interface VoteInfo {
  title: string;
  votes: number;
  color: string;
}

type Props = {
  leagueID: string;
  team1Name: string;
  team2Name: string;
  matchupId: string;
  nflWeek?: number;
  liveGame?: boolean;
};

const COLOR_1 = "#af1222";
const COLOR_2 = "#3b82f6";

export default function SchedulePoll({ leagueID, team1Name, team2Name, matchupId, nflWeek, liveGame }: Props) {
  const [votes, setVotes] = useState<VoteInfo[]>([
    { title: team1Name, votes: 0, color: COLOR_1 },
    { title: team2Name, votes: 0, color: COLOR_2 },
  ]);
  const [userVoted, setUserVoted] = useState(false);

  useEffect(() => {
    (async () => {
      const locked = await storage.getItem(StorageKeys.voteLock(leagueID, matchupId));
      if (locked) setUserVoted(true);
    })();
  }, [leagueID, matchupId]);

  useEffect(() => {
    (async () => {
      try {
        const voteInfo = collection(db, firestoreCollections.matchupPolls);
        const snap = await getDocs(query(voteInfo, where("league_id", "==", leagueID), limit(1)));
        if (snap.empty) return;
        const matchups = snap.docs[0].data().matchups || [];
        const matchup = matchups.find((m: any) => m.matchup_id === matchupId);
        if (matchup) setVotes(matchup.votes);
      } catch (error) {
        console.error("Error retrieving votes from the database:", error);
      }
    })();
  }, [leagueID, matchupId]);

  const totalVotes = votes.reduce((acc, v) => acc + v.votes, 0);
  const [v1, v2] = votes;
  const pct1 = totalVotes ? Math.round((v1.votes / totalVotes) * 100) : 50;
  const pct2 = 100 - pct1;

  const handleVote = async (vote: VoteInfo) => {
    const newVotes = votes.map((v) => (v.title === vote.title ? { ...v, votes: v.votes + 1 } : v));
    setVotes(newVotes);
    setUserVoted(true);
    await storage.setItem(StorageKeys.voteLock(leagueID, matchupId), "true");
    if (nflWeek !== undefined) await storage.setItem(StorageKeys.currentWeek, String(nflWeek));

    try {
      const voteInfo = collection(db, firestoreCollections.matchupPolls);
      const snap = await getDocs(query(voteInfo, where("league_id", "==", leagueID)));
      if (!snap.empty) {
        const docRef = snap.docs[0];
        const existing = docRef.data().matchups || [];
        const idx = existing.findIndex((m: any) => m.matchup_id === matchupId);
        const updated = [...existing];
        if (idx !== -1) updated[idx] = { matchup_id: matchupId, votes: newVotes };
        else updated.push({ matchup_id: matchupId, votes: newVotes });
        await updateDoc(docRef.ref, { matchups: updated });
      } else {
        await addDoc(voteInfo, {
          league_id: leagueID,
          matchups: [{ matchup_id: matchupId, votes: newVotes }],
        });
      }
    } catch (error) {
      console.error("Error adding or updating matchup:", error);
    }
  };

  if (liveGame) {
    const leaderPct = Math.max(pct1, pct2);
    const leaderName = pct1 >= pct2 ? team1Name : team2Name;
    return (
      <View className="items-center justify-center py-3 px-6">
        <View className="flex-row items-center gap-1.5">
          <Feather name="bar-chart-2" size={12} color="#af1222" />
          <Text className="text-[12px] text-gray-400 text-center">
            {totalVotes > 0
              ? `League picked ${abbrev(leaderName)} to win (${leaderPct}%)`
              : "No vote results to display"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="items-center py-2 px-6 w-full">
      <Text className="mb-2.5 text-[11px] font-bold tracking-widest text-gray-500">WHO WILL WIN?</Text>

      {!userVoted ? (
        <View className="flex-row w-full gap-2">
          <PollButton label={team1Name} color={COLOR_1} onPress={() => handleVote(v1)} />
          <PollButton label={team2Name} color={COLOR_2} onPress={() => handleVote(v2)} />
        </View>
      ) : (
        <View className="w-full">
          <View className="flex-row h-9 rounded-full overflow-hidden bg-white/5 dark:bg-white/5">
            <MotiView
              from={{ width: "50%" }}
              animate={{ width: `${pct1}%` }}
              transition={{ type: "timing", duration: 450 }}
              style={{ backgroundColor: COLOR_1 }}
              className="items-center justify-center"
            >
              {pct1 >= 22 && (
                <Text numberOfLines={1} className="text-white text-[11px] font-bold px-2">
                  {abbrev(team1Name)} {pct1}%
                </Text>
              )}
            </MotiView>
            <MotiView
              from={{ width: "50%" }}
              animate={{ width: `${pct2}%` }}
              transition={{ type: "timing", duration: 450 }}
              style={{ backgroundColor: COLOR_2 }}
              className="items-center justify-center"
            >
              {pct2 >= 22 && (
                <Text numberOfLines={1} className="text-white text-[11px] font-bold px-2">
                  {pct2}% {abbrev(team2Name)}
                </Text>
              )}
            </MotiView>
          </View>
          <View className="flex-row items-center justify-center gap-1 mt-2">
            <Feather name="check-circle" size={11} color="#22c55e" />
            <Text className="text-[10px] text-gray-500">
              Thanks for voting · {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function abbrev(name: string) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function PollButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ borderColor: color }}
      className="flex-1 items-center justify-center rounded-full border-2 py-2.5 px-2 min-h-[44px]"
    >
      <Text numberOfLines={1} style={{ color }} className="text-[13px] font-bold">
        {label}
      </Text>
    </Pressable>
  );
}
