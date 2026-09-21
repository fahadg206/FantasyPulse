import { useState } from "react";
import { View, Text, Image, Pressable, Modal, FlatList } from "react-native";
import { Feather } from "@expo/vector-icons";

export type PickableManager = {
  id: string;
  name: string;
  avatar?: string;
};

const helmet = require("../assets/images/helmet2.png");

type Props = {
  label: string;
  options: PickableManager[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  excludeId?: string | null;
};

export default function ManagerPicker({ label, options, selectedId, onSelect, excludeId }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId);
  const list = options.filter((o) => o.id !== excludeId);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between border-2 border-brand/30 rounded-xl px-3 py-2.5 w-[160px]"
      >
        {selected ? (
          <View className="flex-row items-center flex-1">
            <Image
              source={selected.avatar ? { uri: selected.avatar } : helmet}
              className="w-[26px] h-[26px] rounded-full mr-2"
            />
            <Text numberOfLines={1} className="text-[13px] font-bold flex-1 text-black dark:text-white">
              {selected.name}
            </Text>
          </View>
        ) : (
          <Text className="text-[13px] text-gray-500">{label}</Text>
        )}
        <Feather name="chevron-down" size={16} color="#af1222" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center p-8" onPress={() => setOpen(false)}>
          <Pressable className="bg-white dark:bg-[#150f0f] rounded-2xl max-h-[70%]" onPress={() => {}}>
            <Text className="text-center font-bold py-3 border-b border-brand/10 text-black dark:text-white">
              {label}
            </Text>
            <FlatList
              data={list}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  className="flex-row items-center gap-3 px-4 py-3 border-b border-brand/5 dark:border-white/5"
                >
                  <Image source={item.avatar ? { uri: item.avatar } : helmet} className="w-[32px] h-[32px] rounded-full" />
                  <Text className="text-black dark:text-white">{item.name}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
