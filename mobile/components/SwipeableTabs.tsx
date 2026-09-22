import { useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";

// X's own home-feed tab pattern: two tabs, switchable by tapping the
// header OR swiping the content itself, each with its own independent
// vertical scroll. Built on a horizontal pagingEnabled ScrollView with a
// manually-synced underline, not react-native-pager-view - that's a
// native module, and installing one here would need a full native
// rebuild the running dev client can't do without the user rebuilding.
// This needs nothing beyond core React Native, so it works immediately in
// whatever's already running.
export default function SwipeableTabs({
  labels,
  children,
}: {
  labels: [string, string];
  children: [React.ReactNode, React.ReactNode];
}) {
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<0 | 1>(0);
  const scrollRef = useRef<ScrollView>(null);

  const goToTab = (index: 0 | 1) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveTab(index);
  };

  // Momentum-end (not the continuous onScroll) so the underline only
  // jumps once a swipe actually settles on a page, not mid-drag.
  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveTab(e.nativeEvent.contentOffset.x >= width / 2 ? 1 : 0);
  };

  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row border-b border-white/10">
        {labels.map((label, i) => (
          <Pressable key={label} onPress={() => goToTab(i as 0 | 1)} className="flex-1 items-center pt-3 pb-2.5">
            <Text className={`text-[14px] font-bold ${activeTab === i ? "text-white" : "text-gray-500"}`}>
              {label}
            </Text>
            {activeTab === i && <View className="mt-2.5 h-[3px] w-[36px] rounded-full bg-brand" />}
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {children.map((child, i) => (
          <View key={i} style={{ width }}>
            {/* No padding here by design - a post row (Social Profile) is
                meant to sit flush edge-to-edge like the main Feed, while
                Player Profile's stat cards want their own inset. Each
                pane's content brings whatever padding it needs. */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
              {child}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
