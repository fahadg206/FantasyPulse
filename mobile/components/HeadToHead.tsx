import { View, Text, Image } from "react-native";

const helmet = require("../assets/images/helmet2.png");

type Props = {
  nameOne: string;
  avatarOne?: string;
  nameTwo: string;
  avatarTwo?: string;
  winsOne: number;
  winsTwo: number;
  ties: number;
  pointsOne: number;
  pointsTwo: number;
  playoffWinsOne?: number;
  playoffWinsTwo?: number;
  playoffTies?: number;
};

export default function HeadToHead({
  nameOne,
  avatarOne,
  nameTwo,
  avatarTwo,
  winsOne,
  winsTwo,
  ties,
  pointsOne,
  pointsTwo,
  playoffWinsOne = 0,
  playoffWinsTwo = 0,
  playoffTies = 0,
}: Props) {
  const hasPlayoffHistory = playoffWinsOne + playoffWinsTwo + playoffTies > 0;
  const totalWins = winsOne + winsTwo + ties || 1;
  const totalPoints = pointsOne + pointsTwo || 1;
  const winsPctOne = (winsOne / totalWins) * 100;
  const winsPctTwo = (winsTwo / totalWins) * 100;
  const pointsPctOne = (pointsOne / totalPoints) * 100;

  return (
    <View className="w-full bg-[#141416] border border-white/10 rounded-2xl p-5 items-center mb-4">
      <View className="flex-row items-center justify-between w-full mb-4">
        <View className="items-center flex-1">
          <Image source={avatarOne ? { uri: avatarOne } : helmet} className="w-[52px] h-[52px] rounded-full border-2 border-[#3b82f6] mb-1.5" />
          <Text numberOfLines={1} className="text-white font-bold text-[12px]">
            {nameOne}
          </Text>
        </View>
        <Text className="text-gray-500 text-[11px] font-bold px-2">VS</Text>
        <View className="items-center flex-1">
          <Image source={avatarTwo ? { uri: avatarTwo } : helmet} className="w-[52px] h-[52px] rounded-full border-2 border-brand mb-1.5" />
          <Text numberOfLines={1} className="text-white font-bold text-[12px]">
            {nameTwo}
          </Text>
        </View>
      </View>

      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[30px] font-bold">
        {winsOne}-{winsTwo}
        {ties > 0 ? `-${ties}` : ""}
      </Text>
      <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-3">ALL-TIME SERIES</Text>

      {hasPlayoffHistory && (
        <View className="flex-row items-center gap-1.5 bg-[#eab30822] border border-[#eab30840] rounded-full px-3 py-1 mb-3">
          <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#eab308] text-[11px] font-bold">
            PLAYOFFS: {playoffWinsOne}-{playoffWinsTwo}
            {playoffTies > 0 ? `-${playoffTies}` : ""}
          </Text>
        </View>
      )}

      <View className="w-full h-2 rounded-full overflow-hidden flex-row bg-white/10">
        <View style={{ width: `${winsPctOne}%`, backgroundColor: "#3b82f6" }} />
        <View style={{ width: `${100 - winsPctOne - winsPctTwo}%`, backgroundColor: "#4b5563" }} />
        <View style={{ width: `${winsPctTwo}%`, backgroundColor: "#af1222" }} />
      </View>

      <View className="flex-row justify-between w-full mt-4">
        <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[11px] font-semibold">
          {pointsOne.toFixed(1)} PTS
        </Text>
        <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[11px] font-semibold">
          {pointsTwo.toFixed(1)} PTS
        </Text>
      </View>
      <View className="w-full h-1 rounded-full overflow-hidden flex-row bg-white/10 mt-1">
        <View style={{ width: `${pointsPctOne}%`, backgroundColor: "#3b82f6" }} />
        <View style={{ width: `${100 - pointsPctOne}%`, backgroundColor: "#af1222" }} />
      </View>
    </View>
  );
}
