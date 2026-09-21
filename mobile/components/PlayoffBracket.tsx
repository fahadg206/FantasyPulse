import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getPlayoffBracket, Bracket, BracketMatch, BracketTeam } from "../lib/getPlayoffBracket";

const helmet = require("../assets/images/helmet2.png");

const ROUND_LABEL = (round: number, totalRounds: number, placement?: number) => {
  if (placement === 3) return "3RD PLACE";
  if (round === totalRounds) return "CHAMPIONSHIP";
  if (round === totalRounds - 1) return "SEMIFINALS";
  return `ROUND ${round}`;
};

function TeamSlot({ team, isWinner }: { team: BracketTeam | null; isWinner: boolean }) {
  if (!team) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2.5 opacity-40">
        <View className="w-[26px] h-[26px] rounded-full bg-white/10" />
        <Text className="text-gray-500 text-[12px]">TBD</Text>
      </View>
    );
  }
  if (team.placeholderLabel) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2.5">
        <View className="w-[26px] h-[26px] rounded-full bg-white/5 border border-dashed border-white/20" />
        <Text numberOfLines={1} className="text-gray-500 text-[11px] italic flex-1">
          {team.name}
        </Text>
      </View>
    );
  }
  return (
    <View className={`flex-row items-center gap-2 px-3 py-2.5 ${isWinner ? "bg-brand/10" : ""}`}>
      <Image
        source={team.avatar ? { uri: team.avatar } : helmet}
        className={`w-[26px] h-[26px] rounded-full ${isWinner ? "border-2 border-brand" : "border border-white/10"}`}
      />
      <Text
        numberOfLines={1}
        className={`flex-1 text-[12px] ${isWinner ? "text-white font-bold" : "text-gray-400 font-medium"}`}
      >
        {team.name}
      </Text>
      {team.points !== undefined && (
        <Text
          style={{ fontVariant: ["tabular-nums"] }}
          className={`text-[13px] ${isWinner ? "text-brand font-bold" : "text-gray-500 font-semibold"}`}
        >
          {team.points.toFixed(1)}
        </Text>
      )}
    </View>
  );
}

function MatchCard({ match, isFinal }: { match: BracketMatch; isFinal: boolean }) {
  const [teamA, teamB] = match.teams;
  return (
    <View
      className={`bg-[#141416] rounded-2xl overflow-hidden mb-4 ${
        isFinal ? "border-2 border-brand" : "border border-white/10"
      }`}
      style={{ width: 190 }}
    >
      {isFinal && (
        <View className="bg-brand items-center py-1">
          <Ionicons name="trophy" size={12} color="#fff" />
        </View>
      )}
      <TeamSlot team={teamA} isWinner={!!match.winnerRosterId && teamA?.rosterId === match.winnerRosterId} />
      <View className="h-px bg-white/10" />
      <TeamSlot team={teamB} isWinner={!!match.winnerRosterId && teamB?.rosterId === match.winnerRosterId} />
    </View>
  );
}

function BracketColumn({ matches, round, totalRounds }: { matches: BracketMatch[]; round: number; totalRounds: number }) {
  return (
    <View className="mr-3 justify-center">
      <Text className="text-[10px] font-bold tracking-widest text-brand mb-3 text-center">
        {ROUND_LABEL(round, totalRounds, matches[0]?.placement)}
      </Text>
      <View className="flex-1 justify-around">
        {matches.map((m) => (
          <MatchCard key={m.matchId} match={m} isFinal={m.placement === 1} />
        ))}
      </View>
    </View>
  );
}

export default function PlayoffBracket({ leagueID }: { leagueID: string }) {
  const [bracket, setBracket] = useState<Bracket | null | undefined>(undefined);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    getPlayoffBracket(leagueID)
      .then((result) => {
        if (!cancelled) setBracket(result);
      })
      .catch((error) => {
        console.error("Error loading playoff bracket:", error);
        if (!cancelled) setBracket(null);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (bracket === undefined) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  if (!bracket) {
    return (
      <View className="py-8 items-center">
        <Text className="text-gray-500 text-[13px]">Playoffs haven&apos;t started yet this season.</Text>
      </View>
    );
  }

  // Championship/3rd-place games share the final round number but should
  // read as separate columns for legibility.
  const lastRoundMatches = bracket.rounds[bracket.rounds.length - 1] ?? [];
  const championship = lastRoundMatches.filter((m) => m.placement === 1);
  const thirdPlace = lastRoundMatches.filter((m) => m.placement === 3);
  const earlierRounds = bracket.rounds.slice(0, -1);
  const totalRounds = bracket.rounds.length;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-1 py-2">
      {earlierRounds.map((matches, i) => (
        <BracketColumn key={i} matches={matches} round={i + 1} totalRounds={totalRounds} />
      ))}
      <View>
        {championship.length > 0 && (
          <BracketColumn matches={championship} round={totalRounds} totalRounds={totalRounds} />
        )}
        {thirdPlace.length > 0 && (
          <View className="mt-2">
            <BracketColumn matches={thirdPlace} round={totalRounds} totalRounds={totalRounds} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}
