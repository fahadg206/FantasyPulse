// Real push notifications - Boogie's breaking-news wire (trades, injuries)
// reaching a manager's lock screen, not just sitting in the Feed until
// they happen to open the app. Client registers an Expo push token here;
// the actual send happens server-side (see the web app's
// src/pages/api/sendPush.js), since sending a push to someone ELSE's
// device is not something a client should be doing unsupervised even
// under this app's existing "any signed-in client can write" trust model
// for Boogie's own posts.
//
// Two real platform constraints worth knowing before touching this file:
//  1. getExpoPushTokenAsync needs this project's EAS project id
//     (app.json/app.config's extra.eas.projectId) - registerForPushAsync
//     below fails soft (logs, returns null) if that hasn't been set up
//     yet via `eas init`, so the rest of the app is never blocked on it.
//  2. Expo Go has not supported remote push notifications since SDK 53 -
//     testing this for real needs a development build
//     (`npx expo run:ios` / `npx expo run:android`, or an EAS dev build),
//     not the Expo Go app.

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { doc, setDoc } from "firebase/firestore/lite";
import { db } from "./firebase";

// Foreground behavior - a push that arrives while the app is already open
// still shows a banner/plays a sound instead of silently landing only in
// the notification center, same as the OS-level behavior when the app is
// backgrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getEasProjectId(): string | undefined {
  return (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
}

/**
 * Requests notification permission (a no-op if already granted or already
 * denied - this never re-prompts on its own) and returns a real Expo push
 * token, or null if permission was denied, this is a simulator (push
 * tokens don't work there), or the project has no EAS project id yet.
 * Never throws - every failure mode here is a normal "not available right
 * now" case, not a bug.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications: skipping - simulators/emulators don't get real push tokens.");
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Fantasy Pulse",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  const projectId = getEasProjectId();
  if (!projectId) {
    console.log("Push notifications: no EAS project id configured yet (run `eas init`) - skipping token registration.");
    return null;
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    console.error("Error getting Expo push token:", error);
    return null;
  }
}

/** saves (or clears, with token=null) this device's push token on the user's own profile doc - a merge write, so it never touches any other profile field. */
export async function savePushToken(uid: string, token: string | null): Promise<void> {
  await setDoc(doc(db, "profiles", uid), { pushToken: token }, { merge: true });
}

export async function setPushNotificationsEnabled(uid: string, enabled: boolean): Promise<void> {
  await setDoc(doc(db, "profiles", uid), { pushNotificationsEnabled: enabled }, { merge: true });
}

/**
 * The one call site this whole module exists for: flip notifications on,
 * meaning both "the user wants them" AND "we actually have a live device
 * token for them" - registers for a token (prompting for permission if
 * needed) and persists both the opt-in flag and the token together.
 * Returns false if registration didn't produce a token (denied, no EAS
 * project yet, simulator) so the caller's toggle can reflect reality
 * instead of silently claiming success.
 */
export async function enablePushNotifications(uid: string): Promise<boolean> {
  const token = await registerForPushNotificationsAsync();
  if (!token) {
    await setPushNotificationsEnabled(uid, false);
    return false;
  }
  await Promise.all([savePushToken(uid, token), setPushNotificationsEnabled(uid, true)]);
  return true;
}

export async function disablePushNotifications(uid: string): Promise<void> {
  await setPushNotificationsEnabled(uid, false);
}
