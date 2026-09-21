import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";

const PAGES = ["Home", "Articles", "Rivalry", "Schedule", "Standings", "League Managers", "Other"];
const FORM_ENDPOINT = "https://getform.io/f/5c7b4a19-5394-4fef-9e03-ca2ceeef2fca";

export default function Report() {
  const [username, setUsername] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [page, setPage] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  const submit = async () => {
    if (!message.trim()) return;
    setStatus("submitting");
    try {
      const form = new FormData();
      form.append("Sleeper Username", username);
      form.append("League Name", leagueName);
      form.append("page", page ?? "N/A");
      form.append("message", message);

      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Submit failed");
      setStatus("sent");
      setUsername("");
      setLeagueName("");
      setPage(null);
      setMessage("");
    } catch (error) {
      console.error("Error submitting report:", error);
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Feather name="check-circle" size={40} color="green" />
        <Text className="text-lg font-bold mt-3 text-black dark:text-white">Thanks!</Text>
        <Text className="text-center text-gray-500 mt-1">
          Your report was submitted. We&apos;ll take a look.
        </Text>
        <Pressable onPress={() => setStatus("idle")} className="mt-6">
          <Text className="text-brand font-semibold">Submit another report</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="p-5">
      <Text className="text-2xl font-bold border-b border-brand/20 pb-2 mb-2 text-black dark:text-white">
        Report An Issue
      </Text>
      <Text className="text-gray-500 mb-5">
        Submit the form below to report an issue. Please be descriptive!
      </Text>

      <Text className="text-[12px] font-semibold text-gray-500 mb-1">Sleeper Username</Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        className="border border-brand/30 rounded-lg px-3 py-2 mb-4 text-black dark:text-white"
        placeholder="e.g. fahadg"
        placeholderTextColor="#9ca3ab"
      />

      <Text className="text-[12px] font-semibold text-gray-500 mb-1">League Name</Text>
      <TextInput
        value={leagueName}
        onChangeText={setLeagueName}
        className="border border-brand/30 rounded-lg px-3 py-2 mb-4 text-black dark:text-white"
        placeholder="e.g. Dynasty League"
        placeholderTextColor="#9ca3ab"
      />

      <Text className="text-[12px] font-semibold text-gray-500 mb-1">Page</Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {PAGES.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPage(p)}
            className={`px-3 py-2 rounded-full border ${page === p ? "bg-brand border-brand" : "border-brand/30"}`}
          >
            <Text className={page === p ? "text-white text-[12px]" : "text-black dark:text-white text-[12px]"}>
              {p}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-[12px] font-semibold text-gray-500 mb-1">Message</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        className="border border-brand/30 rounded-lg px-3 py-2 mb-2 text-black dark:text-white h-[140px]"
        placeholder="What happened?"
        placeholderTextColor="#9ca3ab"
      />

      {status === "error" && (
        <Text className="text-red-500 text-[12px] mb-2">
          Something went wrong submitting your report — please try again.
        </Text>
      )}

      <Pressable
        onPress={submit}
        disabled={status === "submitting" || !message.trim()}
        className={`items-center justify-center rounded-xl border-2 border-brand py-3 mt-2 ${
          !message.trim() ? "opacity-40" : ""
        }`}
      >
        {status === "submitting" ? (
          <ActivityIndicator color="#af1222" />
        ) : (
          <Text className="text-brand font-bold">Submit!</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
