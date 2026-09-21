import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { backend } from "../../../lib/api";
import { fetchLeagueManagers, fetchRivalry, Rivalry, TeamManagersMap, RivalUser } from "../../../lib/getRivalry";
import ManagerPicker from "../../../components/ManagerPicker";
import HeadToHead from "../../../components/HeadToHead";
import { displayName } from "../../../lib/getTopPerformers";
import { getTeamLogo } from "../../../lib/nflTeams";

const helmet = require("../../../assets/images/helmet2.png");
const matchupsImg = require("../../../assets/images/matchupsImage.png");

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  WR: "#3b82f6",
  RB: "#22c55e",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

function PlayerHalf({
  player,
  playerId,
  points,
  align,
}: {
  player: any;
  playerId: string;
  points: number;
  align: "left" | "right";
}) {
  if (!player) {
    return (
      <View className={`flex-1 flex-row items-center gap-2 ${align === "right" ? "justify-end" : ""}`}>
        <Text className="text-gray-600 text-[11px]">Empty / F.A.</Text>
      </View>
    );
  }
  const isDef = player.pos === "DEF";
  const photoUri = isDef
    ? getTeamLogo(player.t) ?? undefined
    : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;

  const info = (
    <View className={align === "right" ? "items-end" : "items-start"}>
      <Text numberOfLines={1} className="text-white text-[12px] font-semibold max-w-[90px]">
        {displayName(player)}
      </Text>
      <Text style={{ color: POSITION_COLOR[player.pos] ?? "#9ca3af" }} className="text-[9px] font-bold">
        {player.pos}
      </Text>
    </View>
  );
  const photo = (
    <Image
      source={photoUri ? { uri: photoUri } : undefined}
      resizeMode={isDef ? "contain" : "cover"}
      className={isDef ? "w-[30px] h-[30px]" : "w-[32px] h-[32px] rounded-full bg-white/10"}
    />
  );

  return (
    <View className={`flex-1 flex-row items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
      {photo}
      {info}
      <Text
        style={{ fontVariant: ["tabular-nums"] }}
        className="text-white text-[13px] font-bold w-[34px] text-center"
      >
        {points ? points.toFixed(1) : "-"}
      </Text>
    </View>
  );
}

export default function RivalryScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [users, setUsers] = useState<Record<string, RivalUser>>({});
  const [teamManagersMap, setTeamManagersMap] = useState<TeamManagersMap>({});
  const [userOne, setUserOne] = useState<string | null>(null);
  const [userTwo, setUserTwo] = useState<string | null>(null);
  const [rivalry, setRivalry] = useState<Rivalry | null>(null);
  const [loadingManagers, setLoadingManagers] = useState(true);
  const [loadingRivalry, setLoadingRivalry] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [playersData, setPlayersData] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!leagueID) return;
    fetchLeagueManagers(leagueID)
      .then(({ users, teamManagersMap }) => {
        setUsers(users);
        setTeamManagersMap(teamManagersMap);
      })
      .catch((e) => console.error("Error loading league managers:", e))
      .finally(() => setLoadingManagers(false));

    backend.fetchPlayers(leagueID).then(setPlayersData).catch(console.error);
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID || !userOne || !userTwo || userOne === userTwo) return;
    setLoadingRivalry(true);
    setWeekIndex(0);
    fetchRivalry(leagueID, userOne, userTwo, teamManagersMap)
      .then(setRivalry)
      .catch((e) => console.error("Error loading rivalry:", e))
      .finally(() => setLoadingRivalry(false));
  }, [leagueID, userOne, userTwo, teamManagersMap]);

  const managerOptions = useMemo(
    () => Object.values(users).map((u) => ({ id: u.managerID, name: u.userName, avatar: u.avatar })),
    [users]
  );

  const slate = rivalry?.matchups[weekIndex];
  const userOneInfo = users[userOne ?? ""];
  const userTwoInfo = users[userTwo ?? ""];

  if (!leagueID) return null;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 items-center">
      <View className="flex-row items-center gap-3 mb-5">
        <ManagerPicker
          label="Select User"
          options={managerOptions}
          selectedId={userOne}
          onSelect={setUserOne}
          excludeId={userTwo}
        />
        <Text className="font-bold text-white">vs.</Text>
        <ManagerPicker
          label="Select User"
          options={managerOptions}
          selectedId={userTwo}
          onSelect={setUserTwo}
          excludeId={userOne}
        />
      </View>

      {loadingManagers && <ActivityIndicator color="#af1222" className="mt-4" />}

      {!userOne || !userTwo ? (
        <Image source={matchupsImg} className="w-full h-[180px] mt-10 opacity-90" resizeMode="contain" />
      ) : loadingRivalry ? (
        <View className="items-center mt-10">
          <ActivityIndicator color="#af1222" size="large" />
          <Text className="mt-2 text-white">Loading Rivalry…</Text>
        </View>
      ) : !rivalry || rivalry.matchups.length === 0 ? (
        <Text className="mt-10 text-gray-500 text-center px-6">
          These managers haven&apos;t faced each other in a tracked season yet.
        </Text>
      ) : (
        <View className="w-full mt-2">
          <HeadToHead
            nameOne={userOneInfo?.userName ?? ""}
            avatarOne={userOneInfo?.avatar}
            nameTwo={userTwoInfo?.userName ?? ""}
            avatarTwo={userTwoInfo?.avatar}
            winsOne={rivalry.wins.one}
            winsTwo={rivalry.wins.two}
            ties={rivalry.ties}
            pointsOne={rivalry.points.one}
            pointsTwo={rivalry.points.two}
            playoffWinsOne={rivalry.playoffWins.one}
            playoffWinsTwo={rivalry.playoffWins.two}
            playoffTies={rivalry.playoffTies}
          />

          {slate && (
            <View className="items-center">
              <View className="flex-row items-center gap-6 mb-4">
                <Pressable
                  onPress={() => setWeekIndex((i) => Math.max(0, i - 1))}
                  disabled={weekIndex === 0}
                  hitSlop={10}
                  className="p-1"
                >
                  <Feather name="chevron-left" size={22} color={weekIndex === 0 ? "#4b5563" : "#af1222"} />
                </Pressable>
                <View className="items-center">
                  <Text className="font-bold text-white text-[14px]">{slate.year} Season</Text>
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-gray-500 text-[11px]">Week {slate.week}</Text>
                    {slate.isPlayoff && (
                      <View className="bg-[#eab30822] border border-[#eab30840] rounded-full px-1.5 py-0.5">
                        <Text className="text-[#eab308] text-[8px] font-bold tracking-wider">PLAYOFFS</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable
                  onPress={() => setWeekIndex((i) => Math.min(rivalry.matchups.length - 1, i + 1))}
                  disabled={weekIndex === rivalry.matchups.length - 1}
                  hitSlop={10}
                  className="p-1"
                >
                  <Feather
                    name="chevron-right"
                    size={22}
                    color={weekIndex === rivalry.matchups.length - 1 ? "#4b5563" : "#af1222"}
                  />
                </Pressable>
              </View>

              <View className="w-full flex-row justify-around mb-4">
                {slate.matchup.map((side, sideIdx) => {
                  const rosterInfo = teamManagersMap[slate.year]?.[side.roster_id];
                  const total = side.points.reduce((t, v) => t + parseFloat(String(v)), 0);
                  return (
                    <View key={sideIdx} className="items-center">
                      <Image
                        source={
                          rosterInfo?.team.avatar
                            ? { uri: `https://sleepercdn.com/avatars/thumbs/${rosterInfo.team.avatar}` }
                            : helmet
                        }
                        className="w-[36px] h-[36px] rounded-full mb-1"
                      />
                      <Text numberOfLines={1} className="text-[11px] font-bold text-white max-w-[110px]">
                        {rosterInfo?.team.name ?? "Unknown"}
                      </Text>
                      <Text
                        style={{ fontVariant: ["tabular-nums"] }}
                        className="text-[18px] font-bold text-white mt-0.5"
                      >
                        {total.toFixed(2) === "0.00" ? "-" : total.toFixed(1)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View className="w-full bg-[#141416] border border-white/10 rounded-2xl overflow-hidden">
                {slate.matchup[0].starters.map((_, i) => (
                  <View
                    key={i}
                    className={`flex-row items-center px-3 py-2.5 ${
                      i !== slate.matchup[0].starters.length - 1 ? "border-b border-white/5" : ""
                    }`}
                  >
                    <PlayerHalf
                      player={playersData[slate.matchup[0].starters[i]]}
                      playerId={slate.matchup[0].starters[i]}
                      points={slate.matchup[0].points[i]}
                      align="left"
                    />
                    <PlayerHalf
                      player={playersData[slate.matchup[1].starters[i]]}
                      playerId={slate.matchup[1].starters[i]}
                      points={slate.matchup[1].points[i]}
                      align="right"
                    />
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
