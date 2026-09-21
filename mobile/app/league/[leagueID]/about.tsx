import { useState } from "react";
import { View, Text, Image, Pressable, ScrollView, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";

const fahad = require("../../../assets/images/fahad.jpg");
const mahad = require("../../../assets/images/mahad.jpg");
const logo = require("../../../assets/images/Transparent.png");

const FAQS = [
  {
    q: "Does Fantasy Pulse support different fantasy football formats (e.g., PPR, standard, dynasty)?",
    a: "Absolutely! Fantasy Pulse is designed to accommodate various fantasy football formats, including PPR, standard, dynasty, and more.",
  },
  {
    q: "How often is the content updated on Fantasy Pulse?",
    a: "We regularly update our content to provide you with fresh and relevant information — a consistent stream of articles, polls, and insights throughout the season.",
  },
  {
    q: "Is Fantasy Pulse compatible across all fantasy platforms?",
    a: "As of now, Fantasy Pulse is only compatible with Sleeper.",
  },
  {
    q: "How can I provide feedback or suggest new features?",
    a: "We welcome your feedback! Share ideas through our Patreon, and our team actively considers member input when planning updates.",
  },
  {
    q: "Can I use Fantasy Pulse for other sports?",
    a: "Fantasy Pulse is currently focused on fantasy football, with plans to expand to other sports in the future. Stay tuned!",
  },
];

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View className="border-b border-brand/15 dark:border-white/10">
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center justify-between py-4"
      >
        <Text className="font-bold text-[15px] text-black dark:text-white">{title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color="#af1222" />
      </Pressable>
      {open && <View className="pb-4">{children}</View>}
    </View>
  );
}

export default function About() {
  return (
    <ScrollView className="flex-1" contentContainerClassName="p-5">
      <Text className="text-[26px] font-bold text-center text-brand">
        Where Your Fantasy Football Experience
      </Text>
      <Text className="text-[26px] font-bold text-center text-[#e45263] mb-3">
        Comes to Life!
      </Text>
      <Text className="text-center text-[13px] text-gray-500 mb-6">
        Fantasy Pulse is the ultimate fantasy football companion, delivering personalized content
        and interactivity to elevate your fantasy football experience.
      </Text>

      <View className="rounded-xl border border-brand/20 dark:border-white/10 px-4">
        <Section title="Meet the Developers" defaultOpen>
          <View className="flex-row justify-around">
            {[
              { name: "Fahad Guled", img: fahad },
              { name: "Mahad Fahiye", img: mahad },
            ].map((dev) => (
              <View key={dev.name} className="items-center gap-1">
                <Image source={dev.img} className="w-[70px] h-[70px] rounded-full mb-1" />
                <View className="flex-row items-center gap-1">
                  <Image source={logo} className="w-[36px] h-[36px] rounded-lg" />
                  <Text className="text-[13px] font-bold text-black dark:text-white">
                    {dev.name}
                  </Text>
                </View>
                <Text className="text-[10px] text-gray-500 text-center">
                  Co-Founder, Full Stack Developer
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Frequently Asked Questions">
          <View className="gap-4">
            {FAQS.map((item, i) => (
              <View key={i}>
                <Text className="font-bold text-[13px] mb-1 text-black dark:text-white">
                  {i + 1}. {item.q}
                </Text>
                <Text className="text-[13px] text-gray-500 pl-2">{item.a}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Join Our Patreon!">
          <Text className="text-[13px] mb-2 text-black dark:text-white">
            We&apos;re thrilled to invite you to join our Patreon family and become part of our
            creative journey. Benefits of supporting:
          </Text>
          <Text className="text-[13px] mb-2 text-black dark:text-white">
            🗳️ Community Voting — have a say in upcoming features and content.
          </Text>
          <Text className="text-[13px] mb-3 text-black dark:text-white">
            🎉 Early Access — be first to try new features and improvements.
          </Text>
          <Pressable onPress={() => Linking.openURL("https://www.patreon.com/FantasyPulse")}>
            <Text className="text-brand underline font-semibold">Visit our Patreon →</Text>
          </Pressable>
        </Section>
      </View>
    </ScrollView>
  );
}
