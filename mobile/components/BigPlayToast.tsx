import { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { MotiView } from "moti";
import type { FeedPlay } from "../lib/useBigPlayFeed";

interface BigPlayToastProps {
  play: FeedPlay | null;
  /** how long the toast stays up before auto-dismissing, ms */
  durationMs?: number;
}

// A floating notification for a single big play: the player's photo, what
// happened, and their fantasy point swing - green and climbing on a gain,
// red and falling on a loss. Auto-dismisses itself after `durationMs`.
// Mirrors src/app/components/BigPlayToast.tsx on the web app; RN has no
// AnimatePresence-equivalent bundled with moti, so this only animates in
// (no graceful animate-out on dismiss - it just unmounts).
export default function BigPlayToast({ play, durationMs = 6000 }: BigPlayToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!play) return;
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timeout);
  }, [play, durationMs]);

  if (!play || play.pointsDelta === null || !visible) return null;

  const isPositive = play.pointsDelta >= 0;

  return (
    <MotiView
      key={play.id}
      from={{ opacity: 0, translateY: -16, scale: 0.9 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: "timing", duration: 350 }}
      className="flex-row items-center gap-2 rounded-lg bg-[#1a1a1a] p-2 pr-3 border border-white/10"
    >
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${play.player.sleeperId}.jpg` }}
        className="w-9 h-9 rounded-full bg-slate-300"
      />
      <View>
        <Text className="text-[11px] font-semibold text-white">
          {play.player.fn} {play.player.ln}
        </Text>
        <Text className="text-[10px] text-gray-300">{play.playType}</Text>
      </View>
      <Text
        className={`ml-2 text-sm font-bold ${
          isPositive ? "text-green-400" : "text-red-400"
        }`}
      >
        {isPositive ? "+" : ""}
        {play.pointsDelta.toFixed(1)}
      </Text>
    </MotiView>
  );
}
