import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ActivityIndicator } from "react-native";
import { MotiView } from "moti";
import { Feather } from "@expo/vector-icons";
import { getLastCompletedWeek, getOrCreateWeeklyPoll, voteOnWeeklyPoll, WeeklyPollOption } from "../lib/weeklyPoll";
import { storage, StorageKeys } from "../lib/storage";

const helmet = require("../assets/images/helmet2.png");

export default function HomePoll({ leagueID }: { leagueID: string }) {
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<WeeklyPollOption[]>([]);
  const [voted, setVoted] = useState(false);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const { week: lastWeek } = await getLastCompletedWeek();
        const poll = await getOrCreateWeeklyPoll(leagueID, lastWeek);
        if (cancelled) return;
        if (!poll) {
          setWeek(null);
          return;
        }
        setWeek(poll.week);
        setQuestion(poll.question);
        setOptions(poll.options);
        const locked = await storage.getItem(StorageKeys.voteLock(leagueID, `weeklypoll_${poll.week}`));
        if (!cancelled && locked) setVoted(true);
      } catch (error) {
        console.error("Error loading weekly poll:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const handleVote = async (picked: WeeklyPollOption) => {
    if (week === null || voted) return;
    const updated = options.map((o) => (o.label === picked.label ? { ...o, votes: o.votes + 1 } : o));
    setOptions(updated);
    setVoted(true);
    await storage.setItem(StorageKeys.voteLock(leagueID, `weeklypoll_${week}`), "true");
    try {
      await voteOnWeeklyPoll(leagueID, week, updated);
    } catch (error) {
      console.error("Error voting on weekly poll:", error);
    }
  };

  // No real results yet to build a question off of (week 1 before anyone's
  // played, most likely) - nothing worth asking, so the whole section
  // quietly renders nothing rather than an empty/broken-looking card.
  if (!loading && (week === null || options.length === 0)) return null;

  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);

  return (
    <View className="px-4">
      <Text className="text-[13px] font-bold tracking-wider text-gray-500 mb-3">LEAGUE POLL</Text>
      <View className="bg-white/5 border border-white/10 rounded-2xl p-4">
        {loading ? (
          <View className="items-center py-2">
            <ActivityIndicator color="#af1222" size="small" />
          </View>
        ) : (
          <>
            <View className="flex-row items-center gap-1.5 mb-3">
              <Feather name="bar-chart-2" size={13} color="#af1222" />
              <Text className="text-white text-[14px] font-bold flex-1">{question}</Text>
            </View>

            <View className="gap-2">
              {options.map((option) => {
                const pct = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => handleVote(option)}
                    disabled={voted}
                    className="flex-row items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5"
                  >
                    <Image
                      source={option.avatar ? { uri: option.avatar } : helmet}
                      resizeMode={option.isTeamLogo ? "contain" : "cover"}
                      className={option.isTeamLogo ? "w-[38px] h-[38px]" : "w-[38px] h-[38px] rounded-full bg-white/10"}
                    />
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between">
                        <Text numberOfLines={1} className="text-white text-[13px] font-bold flex-1 mr-2">
                          {option.label}
                        </Text>
                        {voted && (
                          <Text style={{ color: option.color }} className="text-[13px] font-bold">
                            {pct}%
                          </Text>
                        )}
                      </View>
                      <Text numberOfLines={1} className="text-gray-500 text-[11px] mt-0.5">
                        {option.sublabel}
                      </Text>
                      {voted && (
                        <View className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
                          <MotiView
                            from={{ width: "0%" }}
                            animate={{ width: `${pct}%` }}
                            transition={{ type: "timing", duration: 450 }}
                            style={{ backgroundColor: option.color }}
                            className="h-full rounded-full"
                          />
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {voted && (
              <View className="flex-row items-center justify-center gap-1 mt-3">
                <Feather name="check-circle" size={11} color="#22c55e" />
                <Text className="text-[10px] text-gray-500">
                  Thanks for voting · {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
