import { View } from "react-native";
import { MotiView } from "moti";

// A plain gray block that pulses in place - the "silhouette" shape of
// whatever's still loading, instead of a spinner that gives no sense of
// what's about to appear. Shared by every skeleton composition below so
// they all pulse in sync and at the same rate.
export function SkeletonBlock({ className, style }: { className?: string; style?: object }) {
  return (
    <MotiView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.85 }}
      transition={{ type: "timing", duration: 750, loop: true, repeatReverse: true }}
      style={style}
      className={`bg-white/10 rounded-md ${className ?? ""}`}
    />
  );
}

/** The career stats strip - 4 tiles, each a value bar over a label bar. */
export function SkeletonStatsBar() {
  return (
    <View className="flex-row bg-[#141416] rounded-2xl border border-white/10 mb-4 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className={`flex-1 items-center py-3.5 ${i !== 3 ? "border-r border-white/10" : ""}`}>
          <SkeletonBlock className="w-8 h-4 mb-1.5" />
          <SkeletonBlock className="w-12 h-2.5" />
        </View>
      ))}
    </View>
  );
}

/** One league/list row - a circle, two stacked text bars, a right-aligned value. Reused for leagues, top rostered players, and recent acquisitions. */
export function SkeletonRow({ withCard }: { withCard?: boolean }) {
  const row = (
    <View className="flex-row items-center justify-between px-4 py-3">
      <View className="flex-row items-center flex-1 mr-2">
        <SkeletonBlock className="w-7 h-7 rounded-full mr-2.5" />
        <View className="flex-1 gap-1.5">
          <SkeletonBlock className="w-[55%] h-3" />
          <SkeletonBlock className="w-[35%] h-2.5" />
        </View>
      </View>
      <SkeletonBlock className="w-12 h-3" />
    </View>
  );
  if (!withCard) {
    return <View className="bg-[#141416] rounded-xl border border-white/10 mb-2">{row}</View>;
  }
  return row;
}

/** The matchup card shape - two avatar+name+score sides facing off. */
export function SkeletonMatchupCard() {
  return (
    <View className="bg-[#141416] rounded-2xl border border-white/10 p-3.5 mb-2.5">
      <SkeletonBlock className="w-24 h-2.5 mb-3" />
      <View className="flex-row items-center justify-between">
        <View className="flex-1 gap-1.5">
          <View className="flex-row items-center gap-1.5">
            <SkeletonBlock className="w-[22px] h-[22px] rounded-full" />
            <SkeletonBlock className="w-16 h-3" />
          </View>
          <SkeletonBlock className="w-10 h-4" />
        </View>
        <SkeletonBlock className="w-5 h-2.5 mx-2" />
        <View className="flex-1 items-end gap-1.5">
          <View className="flex-row items-center gap-1.5">
            <SkeletonBlock className="w-16 h-3" />
            <SkeletonBlock className="w-[22px] h-[22px] rounded-full" />
          </View>
          <SkeletonBlock className="w-10 h-4" />
        </View>
      </View>
    </View>
  );
}

/** A whole card of stacked list rows - top rostered players / recent acquisitions while loading. */
export function SkeletonListCard({ rows = 3 }: { rows?: number }) {
  return (
    <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mb-4">
      <SkeletonBlock className="w-32 h-2.5 mb-3" />
      <View className="gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <SkeletonBlock className="w-[26px] h-[26px] rounded-full" />
              <SkeletonBlock className="flex-1 h-3" style={{ maxWidth: 140 }} />
            </View>
            <SkeletonBlock className="w-14 h-2.5" />
          </View>
        ))}
      </View>
    </View>
  );
}
