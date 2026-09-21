import { useState } from "react";
import { Text, Pressable, Modal, FlatList } from "react-native";
import { Feather } from "@expo/vector-icons";

type Props = {
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
};

// Matches the deployed web app: a single "Pick an Article" pill that opens a
// list, rather than a segmented control.
export default function ArticlePicker({ options, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === selected);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-2 bg-[#1c1c1e] rounded-full px-5 py-3 min-h-[44px] max-w-full"
      >
        <Text numberOfLines={1} className="text-white font-bold text-[14px] max-w-[220px]">
          {current?.label || "Pick an Article"}
        </Text>
        <Feather name="chevron-down" size={16} color="#ffffff" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center p-8" onPress={() => setOpen(false)}>
          <Pressable className="bg-[#1c1c1e] rounded-2xl overflow-hidden" onPress={() => {}}>
            <FlatList
              data={options}
              keyExtractor={(item) => item.key}
              renderItem={({ item, index }) => (
                <Pressable
                  onPress={() => {
                    onSelect(item.key);
                    setOpen(false);
                  }}
                  className={`px-5 py-4 ${index !== options.length - 1 ? "border-b border-white/10" : ""}`}
                >
                  <Text
                    className={`text-[15px] ${item.key === selected ? "text-brand font-bold" : "text-white font-medium"}`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
