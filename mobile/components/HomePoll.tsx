import { useEffect, useState } from "react";
import { View, Text, Image, Pressable } from "react-native";
import { MotiView } from "moti";
import { collection, query, where, getDocs, addDoc, updateDoc, limit } from "firebase/firestore/lite";
import { db } from "../lib/firebase";
import { firestoreCollections } from "../lib/api";

interface PlayerVoteInfo {
  playerName: string;
  avatar: string;
  matchup: string;
  votes: number;
  color: string;
}

const DEFAULT_VOTES: PlayerVoteInfo[] = [
  {
    playerName: "Jared Goff",
    avatar: "https://sleepercdn.com/content/nfl/players/thumb/3163.jpg",
    matchup: "@ LAR",
    votes: 0,
    color: "#af1222",
  },
  {
    playerName: "Jayden Daniels",
    avatar: "https://sleepercdn.com/content/nfl/players/thumb/11566.jpg",
    matchup: "@ TB",
    votes: 0,
    color: "#1a1a1a",
  },
  {
    playerName: "Tua Tagovailoa",
    avatar: "https://sleepercdn.com/content/nfl/players/thumb/6768.jpg",
    matchup: "vs. JAC",
    votes: 0,
    color: "#e45263",
  },
];

export default function HomePoll() {
  const [votes, setVotes] = useState<PlayerVoteInfo[]>(DEFAULT_VOTES);
  const [voted, setVoted] = useState(false);

  const getVotes = async () => {
    try {
      const voteInfo = collection(db, firestoreCollections.homePoll);
      const snap = await getDocs(query(voteInfo, where("id", "==", "homepoll"), limit(1)));
      if (!snap.empty) setVotes(snap.docs[0].data().votes);
    } catch (error) {
      console.error("Error getting votes from the database:", error);
    }
  };

  useEffect(() => {
    getVotes();
  }, []);

  const totalVotes = votes.reduce((acc, v) => acc + v.votes, 0);

  const handleVote = async (vote: PlayerVoteInfo) => {
    const newVotes = votes.map((v) =>
      v.playerName === vote.playerName ? { ...v, votes: v.votes + 1 } : v
    );
    setVotes(newVotes);
    setVoted(true);
    try {
      const voteInfo = collection(db, firestoreCollections.homePoll);
      const snap = await getDocs(query(voteInfo, where("id", "==", "homepoll")));
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, { votes: newVotes });
      } else {
        await addDoc(voteInfo, { votes: newVotes, id: "homepoll" });
      }
    } catch (error) {
      console.error("Error adding votes to the database:", error);
    }
  };

  return (
    <View className="w-full px-4 mb-6">
      <Text className="mb-2 text-lg font-semibold text-center text-white">
        Vote for who you&apos;d rather start!
      </Text>

      {!voted && (
        <View className="items-center gap-2">
          {votes.map((vote) => (
            <Pressable
              key={vote.playerName}
              onPress={() => handleVote(vote)}
              style={{ backgroundColor: vote.color }}
              className="w-[80%] max-w-xs rounded-xl py-2 px-3 flex-row justify-between items-center"
            >
              <Image source={{ uri: vote.avatar }} className="w-[36px] h-[36px] rounded-full" />
              <Text className="ml-2 flex-1 text-left text-sm text-white">{vote.playerName}</Text>
              <Text className="text-xs italic text-[#e8dede]">{vote.matchup}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View className="flex-row justify-center gap-2 mt-4 h-[120px]">
        {votes.map((vote) => {
          const height = totalVotes ? (vote.votes / totalVotes) * 100 : 0;
          return (
            <View
              key={vote.playerName}
              className="w-[70px] rounded-2xl bg-slate-800 overflow-hidden justify-end"
            >
              <MotiView
                animate={{ height: `${height}%` }}
                transition={{ type: "spring" }}
                style={{ backgroundColor: vote.color, width: "100%" }}
              />
              <Text className="absolute bottom-1 self-center text-[10px] text-white text-center px-1">
                {vote.votes} votes
              </Text>
            </View>
          );
        })}
      </View>

      <Text className="italic text-gray-400 text-sm text-center mt-2">{totalVotes} votes</Text>
    </View>
  );
}
