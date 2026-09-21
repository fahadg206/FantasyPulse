import { useState } from "react";
import { View, Text, Image, Pressable, Modal, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";

const elJefe = require("../assets/images/hamsa.png");
const boogie = require("../assets/images/boogie.png");

const AUTHORS = [
  {
    name: "El Jefe",
    title: "Head of Media Department",
    about:
      "El Jefe, the Head of Media Department at FantasyPulse, is a fearless predictor in the world of fantasy sports. Known for relying on his gut instincts and making bold predictions that often leave fans in awe.",
    image: elJefe,
  },
  {
    name: "Boogie The Writer",
    title: "Fantasy Pulse Senior Staff Writer",
    about:
      "Boogie The Writer, a Senior Staff Writer at FantasyPulse, is a seasoned sports journalist with a knack for bringing the excitement of sports matchups to life through vivid, engaging storytelling.",
    image: boogie,
  },
];

export default function ShowAuthors({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      {compact ? (
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={6}
          className="w-[44px] h-[44px] rounded-full bg-white/5 border border-white/10 items-center justify-center"
        >
          <Feather name="edit-3" size={16} color="#af1222" />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={4}
          className="flex-row items-center gap-2 px-4 py-3 min-h-[44px] rounded-lg bg-white/5 border border-white/10"
        >
          <Text className="text-[13px] font-bold text-white">This Week&apos;s Authors!</Text>
          <Feather name="edit-3" size={14} color="#af1222" />
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-center bg-black/60 p-6">
          <View className="bg-[#151010] rounded-2xl max-h-[80%] border border-white/10">
            <Text className="text-center font-bold text-lg py-4 text-white">This Week&apos;s Authors</Text>
            <ScrollView className="px-4">
              {AUTHORS.map((author) => (
                <View key={author.name} className="items-center border-b border-white/10 pb-4 mb-4">
                  <Image source={author.image} className="w-[110px] h-[110px] rounded-xl mb-2" />
                  <Text className="text-[17px] font-bold text-white">{author.name}</Text>
                  <Text className="text-[11px] mb-2 text-gray-400">{author.title}</Text>
                  <Text className="text-[13px] text-gray-300">{author.about}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              className="items-center justify-center py-4 min-h-[48px] border-t border-white/10"
            >
              <Text className="font-bold text-[14px] text-brand">Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
