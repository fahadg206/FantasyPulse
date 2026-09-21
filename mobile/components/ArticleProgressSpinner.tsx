import { useEffect, useState } from "react";
import { View, Text, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { storage, StorageKeys } from "../lib/storage";

const logo = require("../assets/images/Transparent.png");

export default function ArticleProgressSpinner() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    storage.getItem(StorageKeys.progressValue).then((stored) => {
      if (stored) setValue(parseFloat(stored));
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue((v) => (v >= 100 ? 100 : v + 0.64));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    storage.setItem(StorageKeys.progressValue, String(value));
  }, [value]);

  return (
    <View className="items-center justify-center gap-3">
      {value < 100 ? (
        <>
          <ActivityIndicator color="#af1222" size="large" />
          <Image source={logo} className="w-[100px] h-[100px]" resizeMode="contain" />
        </>
      ) : (
        <View className="flex-row items-center">
          <Text className="text-[14px] text-white">Articles are ready! It is now safe to refresh!</Text>
          <Ionicons name="checkmark-circle" size={22} color="green" style={{ marginLeft: 4 }} />
        </View>
      )}
    </View>
  );
}
