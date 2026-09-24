import { View, Text, Image, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getTeamColor, getTeamLogo } from "../lib/nflTeams";
import { usePlayerDetail } from "./PlayerDetailProvider";

type Props = {
  playerId?: string;
  photoUri?: string;
  name: string;
  position: string;
  team?: string;
  variant?: "row" | "tile";
  rightSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode;
  /** shows a small tappable info affordance that opens the full player detail (game log, season trend) - its own nested Pressable with stopPropagation, so it's safe to add even where the whole card already has its own tap behavior (add/remove from a trade, etc.) */
  onExpand?: () => void;
};

// Mirrors the web app's player-card treatment: the team's primary color fills
// the whole card, with the team logo bled large and faded behind the photo -
// the logo is part of the background art, not a small badge.
export default function PlayerCard({
  playerId,
  photoUri: photoUriOverride,
  name,
  position,
  team,
  variant = "row",
  rightSlot,
  bottomSlot,
  onExpand,
}: Props) {
  const color = getTeamColor(team);
  const logo = getTeamLogo(team);
  const photoUri =
    photoUriOverride ??
    (position === "DEF" ? logo ?? undefined : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`);

  // Falls back to the app-wide player detail modal (see
  // PlayerDetailProvider, mounted once per league) whenever a caller
  // doesn't wire its own onExpand - every PlayerCard is tappable to a real
  // player page by default, the same way every player row in Sleeper's
  // own app is, without each screen having to opt in individually.
  const playerDetail = usePlayerDetail();
  const handleExpand = onExpand ?? (playerId ? () => playerDetail?.openPlayer({ playerId, name, position, team }) : undefined);

  const expandButton = (positionClass: string) =>
    handleExpand && (
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          handleExpand();
        }}
        hitSlop={8}
        className={`absolute ${positionClass} w-5 h-5 rounded-full bg-black/30 items-center justify-center z-10`}
      >
        <Feather name="bar-chart-2" size={10} color="#fff" />
      </Pressable>
    );

  if (variant === "tile") {
    return (
      <View style={{ backgroundColor: color }} className="rounded-xl overflow-hidden">
        {expandButton("top-1.5 right-1.5")}
        {logo && (
          <Image
            source={{ uri: logo }}
            resizeMode="contain"
            style={{ position: "absolute", width: 96, height: 96, opacity: 0.3, right: -20, top: -14 }}
          />
        )}
        <View className="items-center px-2 pt-3 pb-2">
          <Image
            source={photoUri ? { uri: photoUri } : undefined}
            className={position === "DEF" ? "w-[36px] h-[36px] mb-1" : "w-[44px] h-[44px] rounded-full mb-1 bg-white/20"}
            resizeMode={position === "DEF" ? "contain" : "cover"}
          />
          <Text numberOfLines={1} className="text-white text-[11px] font-bold text-center">
            {name}
          </Text>
          <Text className="text-white/80 text-[9px] font-semibold">
            {position}
            {team ? ` · ${team}` : ""}
          </Text>
          {bottomSlot}
        </View>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: color }} className="rounded-xl overflow-hidden">
      {expandButton("top-1.5 left-1.5")}
      {logo && (
        <Image
          source={{ uri: logo }}
          resizeMode="contain"
          style={{ position: "absolute", width: 110, height: 110, opacity: 0.32, right: -18, top: -20 }}
        />
      )}
      <View className="flex-row items-center px-2.5 py-2.5">
        <Image
          source={photoUri ? { uri: photoUri } : undefined}
          className={position === "DEF" ? "w-[40px] h-[40px]" : "w-[44px] h-[44px] rounded-full bg-white/20"}
          resizeMode={position === "DEF" ? "contain" : "cover"}
        />
        <View className="flex-1 ml-3">
          <Text numberOfLines={1} className="text-white font-bold text-[13px]">
            {name}
          </Text>
          <Text className="text-white/85 text-[11px] font-medium">
            {position}
            {team ? ` - ${team}` : ""}
          </Text>
          {bottomSlot}
        </View>
        {rightSlot}
      </View>
    </View>
  );
}
