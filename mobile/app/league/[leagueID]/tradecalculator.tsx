import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, Modal, FlatList } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather, FontAwesome } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import ManagerPicker, { PickableManager } from "../../../components/ManagerPicker";
import PlayerCard from "../../../components/PlayerCard";
import TradeHistory from "../../../components/TradeHistory";
import { displayName } from "../../../lib/getTopPerformers";

const helmet = require("../../../assets/images/helmet2.png");

interface Player {
  id: string;
  fn: string;
  ln: string;
  pos: string;
  t: string;
  value: number;
}

const ACCEPTANCE_BUFFER = 1000;

function Stars({ value }: { value: number }) {
  const full = Math.floor(value / 2000);
  const remainder = value % 2000;
  const partial = remainder >= 500 ? (remainder >= 1500 ? 0.75 : remainder >= 1000 ? 0.5 : 0.25) : 0;
  return (
    <View className="flex-row gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <FontAwesome key={i} name="star" size={11} color="#eab308" />
      ))}
      {partial > 0 && <FontAwesome name="star-half-full" size={11} color="#eab308" />}
    </View>
  );
}

function tradeStatus(diffToEven: number, rawDiff: number) {
  if (diffToEven <= ACCEPTANCE_BUFFER) return { text: "Fair trade", color: "#22c55e" };
  if (rawDiff <= ACCEPTANCE_BUFFER) return { text: "Almost fair", color: "#eab308" };
  if (rawDiff <= ACCEPTANCE_BUFFER * 2) return { text: "Unfair", color: "#f97316" };
  return { text: "Highway Robbery", color: "#ef4444" };
}

export default function TradeCalculator() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [users, setUsers] = useState<PickableManager[]>([]);
  const [playersData, setPlayersData] = useState<Record<string, Player>>({});
  const [scoringType, setScoringType] = useState("");
  const [selectedOne, setSelectedOne] = useState<string | null>(null);
  const [selectedTwo, setSelectedTwo] = useState<string | null>(null);
  const [team1Roster, setTeam1Roster] = useState<string[]>([]);
  const [team2Roster, setTeam2Roster] = useState<string[]>([]);
  const [team1Trade, setTeam1Trade] = useState<Player[]>([]);
  const [team2Trade, setTeam2Trade] = useState<Player[]>([]);
  const [pickerFor, setPickerFor] = useState<1 | 2 | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    sleeper.getLeagueUsers(leagueID).then((res) => {
      setUsers(
        res.data.map((u: any) => ({
          id: u.user_id,
          name: u.display_name,
          avatar: u.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : undefined,
        }))
      );
    });
    backend.fetchPlayers(leagueID).then(setPlayersData).catch(console.error);
    sleeper.getLeague(leagueID).then(async (leagueRes) => {
      try {
        const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/drafts`);
        const drafts = await draftsRes.json();
        setScoringType(drafts[0]?.metadata?.scoring_type || "");
      } catch (e) {
        console.error(e);
      }
    });
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID || !selectedOne || !selectedTwo) return;
    sleeper.getLeagueRosters(leagueID).then((res) => {
      const rosters = res.data;
      const t1 = rosters.find((r: any) => r.owner_id === selectedOne);
      const t2 = rosters.find((r: any) => r.owner_id === selectedTwo);
      setTeam1Roster(t1?.players ?? []);
      setTeam2Roster(t2?.players ?? []);
      setTeam1Trade([]);
      setTeam2Trade([]);
    });
  }, [leagueID, selectedOne, selectedTwo]);

  const addPlayer = async (team: 1 | 2, playerId: string) => {
    const player = playersData[playerId];
    if (!player) return;
    const { value } = await backend.fetchPlayerValue(playerId, scoringType).catch(() => ({ value: 500 }));
    const withId: Player = { ...player, id: playerId, value: value ?? 500 };
    if (team === 1) {
      setTeam1Trade((t) => [...t, withId]);
      setTeam1Roster((r) => r.filter((id) => id !== playerId));
    } else {
      setTeam2Trade((t) => [...t, withId]);
      setTeam2Roster((r) => r.filter((id) => id !== playerId));
    }
    setPickerFor(null);
  };

  const removePlayer = (team: 1 | 2, playerId: string) => {
    if (team === 1) {
      setTeam1Trade((t) => t.filter((p) => p.id !== playerId));
      setTeam1Roster((r) => [...r, playerId]);
    } else {
      setTeam2Trade((t) => t.filter((p) => p.id !== playerId));
      setTeam2Roster((r) => [...r, playerId]);
    }
  };

  const team1Total = team1Trade.reduce((s, p) => s + (p.value || 0), 0);
  const team2Total = team2Trade.reduce((s, p) => s + (p.value || 0), 0);
  const rawDiff = Math.abs(team1Total - team2Total);
  const status = useMemo(() => tradeStatus(rawDiff, rawDiff), [rawDiff]);
  const total = team1Total + team2Total || 1;
  const pct1 = (team1Total / total) * 100;

  const userOne = users.find((u) => u.id === selectedOne);
  const userTwo = users.find((u) => u.id === selectedTwo);
  const pickerRoster = pickerFor === 1 ? team1Roster : team2Roster;

  if (!leagueID) return null;

  return (
    <ScrollView className="flex-1" contentContainerClassName="p-4">
      <Text className="text-xl font-bold text-center mb-4 text-black dark:text-white">
        Trade Calculator
      </Text>

      <View className="flex-row justify-center items-center gap-3 mb-5">
        <ManagerPicker label="Select Team" options={users} selectedId={selectedOne} onSelect={setSelectedOne} excludeId={selectedTwo} />
        <Text className="font-bold text-black dark:text-white">vs.</Text>
        <ManagerPicker label="Select Team" options={users} selectedId={selectedTwo} onSelect={setSelectedTwo} excludeId={selectedOne} />
      </View>

      {selectedOne && selectedTwo && (
        <>
          <View className="flex-row gap-3 mb-4">
            <Pressable
              onPress={() => setPickerFor(1)}
              className="flex-1 flex-row items-center justify-center gap-2 border-2 border-brand rounded-xl py-2.5"
            >
              <Feather name="plus" size={14} color="#af1222" />
              <Text className="text-brand text-[12px] font-semibold">Add from {userOne?.name}</Text>
            </Pressable>
            <Pressable
              onPress={() => setPickerFor(2)}
              className="flex-1 flex-row items-center justify-center gap-2 border-2 border-brand rounded-xl py-2.5"
            >
              <Feather name="plus" size={14} color="#af1222" />
              <Text className="text-brand text-[12px] font-semibold">Add from {userTwo?.name}</Text>
            </Pressable>
          </View>

          <View className="flex-row gap-3">
            <TradeBasket
              title={userOne?.name ?? ""}
              avatar={userOne?.avatar}
              players={team1Trade}
              onRemove={(id) => removePlayer(1, id)}
              onClear={() => {
                setTeam1Roster((r) => [...r, ...team1Trade.map((p) => p.id)]);
                setTeam1Trade([]);
              }}
            />
            <TradeBasket
              title={userTwo?.name ?? ""}
              avatar={userTwo?.avatar}
              players={team2Trade}
              onRemove={(id) => removePlayer(2, id)}
              onClear={() => {
                setTeam2Roster((r) => [...r, ...team2Trade.map((p) => p.id)]);
                setTeam2Trade([]);
              }}
            />
          </View>

          {(team1Trade.length > 0 || team2Trade.length > 0) && (
            <View className="mt-5 bg-[#f0eeee] dark:bg-[#1a1414] rounded-2xl p-4">
              <Text className="text-center text-[10px] font-bold tracking-widest text-gray-400 mb-3">
                TRADE VALUE
              </Text>

              <View className="flex-row items-center">
                <View className="flex-1 items-center">
                  <Image source={userOne?.avatar ? { uri: userOne.avatar } : helmet} className="w-[38px] h-[38px] rounded-full mb-1.5" />
                  <Text numberOfLines={1} className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 max-w-[100px]">
                    {userOne?.name}
                  </Text>
                  <Text style={{ color: "#3b82f6" }} className="text-[20px] font-bold mt-0.5">
                    {team1Total.toLocaleString()}
                  </Text>
                </View>

                <Text className="text-[11px] font-bold text-gray-400 px-2">VS</Text>

                <View className="flex-1 items-center">
                  <Image source={userTwo?.avatar ? { uri: userTwo.avatar } : helmet} className="w-[38px] h-[38px] rounded-full mb-1.5" />
                  <Text numberOfLines={1} className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 max-w-[100px]">
                    {userTwo?.name}
                  </Text>
                  <Text className="text-brand text-[20px] font-bold mt-0.5">{team2Total.toLocaleString()}</Text>
                </View>
              </View>

              <View className="mt-4">
                <View className="h-2.5 rounded-full overflow-hidden flex-row bg-gray-300 dark:bg-white/10">
                  <View style={{ width: `${pct1}%`, backgroundColor: "#3b82f6" }} />
                  <View className="bg-brand" style={{ width: `${100 - pct1}%` }} />
                </View>
                <View className="flex-row justify-between mt-1.5">
                  <Text style={{ color: "#3b82f6" }} className="text-[11px] font-bold">
                    {pct1.toFixed(0)}%
                  </Text>
                  <Text className="text-brand text-[11px] font-bold">{(100 - pct1).toFixed(0)}%</Text>
                </View>
              </View>

              <View
                style={{ backgroundColor: `${status.color}22`, borderColor: status.color }}
                className="self-center mt-3.5 px-4 py-1.5 rounded-full border"
              >
                <Text style={{ color: status.color }} className="font-bold text-[13px]">
                  {status.text}
                </Text>
              </View>
            </View>
          )}
        </>
      )}

      {leagueID && (
        <TradeHistory
          leagueID={leagueID}
          userIds={selectedOne && selectedTwo ? [selectedOne, selectedTwo] : undefined}
        />
      )}

      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setPickerFor(null)}>
          <Pressable className="bg-white dark:bg-[#150f0f] rounded-t-2xl max-h-[70%]" onPress={() => {}}>
            <Text className="text-center font-bold py-3 border-b border-brand/10 text-black dark:text-white">
              Add a player
            </Text>
            <FlatList
              data={pickerRoster}
              keyExtractor={(id) => id}
              contentContainerClassName="p-3 gap-2"
              renderItem={({ item: playerId }) => {
                const player = playersData[playerId];
                if (!player) return null;
                return (
                  <Pressable onPress={() => pickerFor && addPlayer(pickerFor, playerId)} className="mb-2">
                    <PlayerCard
                      playerId={playerId}
                      name={displayName(player)}
                      position={player.pos}
                      team={player.t}
                      rightSlot={<Feather name="plus-circle" size={20} color="#ffffff" />}
                    />
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function TradeBasket({
  title,
  avatar,
  players,
  onRemove,
  onClear,
}: {
  title: string;
  avatar?: string;
  players: Player[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <View className="flex-1 bg-[#f0eeee] dark:bg-[#1a1414] rounded-xl p-2">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-1 flex-1">
          <Image source={avatar ? { uri: avatar } : helmet} className="w-[26px] h-[26px] rounded-full" />
          <Text numberOfLines={1} className="font-bold text-[12px] text-black dark:text-white">
            {title}
          </Text>
        </View>
        {players.length > 0 && (
          <Pressable onPress={onClear}>
            <Text className="text-brand text-[11px]">Clear</Text>
          </Pressable>
        )}
      </View>
      <View className="gap-2">
        {players.map((p) => (
          <PlayerCard
            key={p.id}
            playerId={p.id}
            name={displayName(p)}
            position={p.pos}
            team={p.t}
            bottomSlot={<Stars value={p.value} />}
            rightSlot={
              <Pressable onPress={() => onRemove(p.id)} hitSlop={8} className="pl-1">
                <Feather name="x-circle" size={18} color="#ffffff" />
              </Pressable>
            }
          />
        ))}
      </View>
    </View>
  );
}
