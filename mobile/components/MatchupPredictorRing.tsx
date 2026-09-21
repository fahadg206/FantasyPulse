import { View, Text, Image } from "react-native";
import Svg, { Circle } from "react-native-svg";

const SIZE = 150;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  pct1: number;
  pct2: number;
  team1Name: string;
  team2Name: string;
  team1Avatar: any;
  team2Avatar: any;
  color1?: string;
  color2?: string;
};

export default function MatchupPredictorRing({
  pct1,
  pct2,
  team1Name,
  team2Name,
  team1Avatar,
  team2Avatar,
  color1 = "#af1222",
  color2 = "#3b82f6",
}: Props) {
  const favoredAvatar = pct1 >= pct2 ? team1Avatar : team2Avatar;
  const favoredColor = pct1 >= pct2 ? color1 : color2;
  const arcLength = (pct1 / 100) * CIRCUMFERENCE;

  return (
    <View className="items-center">
      <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-3">MATCHUP PREDICTOR</Text>

      <View className="flex-row items-center justify-center gap-4">
        <View className="items-center w-[64px]">
          <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[20px] font-bold">
            {pct1}%
          </Text>
          <Text numberOfLines={1} style={{ color: color1 }} className="text-[10px] font-bold mt-0.5">
            {abbrev(team1Name)}
          </Text>
        </View>

        <View style={{ width: SIZE, height: SIZE }}>
          <Svg width={SIZE} height={SIZE}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={color2} strokeWidth={STROKE} fill="none" />
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke={color1}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${arcLength} ${CIRCUMFERENCE - arcLength}`}
              strokeLinecap="butt"
              originX={SIZE / 2}
              originY={SIZE / 2}
              rotation={-90}
            />
          </Svg>
          <View style={{ position: "absolute", top: STROKE + 6, left: STROKE + 6, right: STROKE + 6, bottom: STROKE + 6 }}>
            <View
              style={{ borderColor: favoredColor }}
              className="flex-1 rounded-full border-2 items-center justify-center bg-[#1c1c1e] overflow-hidden"
            >
              <Image
                source={typeof favoredAvatar === "string" ? { uri: favoredAvatar } : favoredAvatar}
                className="w-full h-full"
                resizeMode="cover"
              />
            </View>
          </View>
        </View>

        <View className="items-center w-[64px]">
          <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[20px] font-bold">
            {pct2}%
          </Text>
          <Text numberOfLines={1} style={{ color: color2 }} className="text-[10px] font-bold mt-0.5">
            {abbrev(team2Name)}
          </Text>
        </View>
      </View>

      <Text className="text-center text-[9px] text-gray-500 mt-3">According to Fantasy Pulse analytics</Text>
    </View>
  );
}

function abbrev(name: string) {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
