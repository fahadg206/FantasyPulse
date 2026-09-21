import "../global.css";
import "../lib/firebase";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SelectedManagerProvider } from "../context/SelectedManagerContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SelectedManagerProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </SelectedManagerProvider>
    </SafeAreaProvider>
  );
}
