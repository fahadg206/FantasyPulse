import { initializeApp, getApps, getApp } from "firebase/app";
// @ts-expect-error getReactNativePersistence exists in the RN build but is
// missing from firebase/auth's public TypeScript types in some SDK versions.
import { initializeAuth, getReactNativePersistence, getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore/lite";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Copied verbatim from src/app/firebase.js - this is public web config, not a secret.
const firebaseConfig = {
  apiKey: "AIzaSyBLCVmOdpdjWZOHgcvUDsS37udjRrvXNwg",
  authDomain: "fantasypulse-3523b.firebaseapp.com",
  projectId: "fantasypulse-3523b",
  storageBucket: "fantasypulse-3523b.appspot.com",
  messagingSenderId: "537780473762",
  appId: "1:537780473762:web:80cb568792997aa615ecfb",
  measurementId: "G-B885Y5X02R",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Default firebase/auth persistence relies on `window` and silently fails to
// persist across RN app restarts without this. initializeAuth throws if
// called more than once on the same app instance, which happens on every
// Metro Fast Refresh of this module during dev - fall back to the already
// -initialized instance instead of crashing.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = getFirestore(app);
export const storage = getStorage(app);
export const storageBucket = firebaseConfig.storageBucket;

// Falls back to an anonymous session only once it's actually confirmed
// there's no real one already persisted - calling signInAnonymously
// unconditionally at module load (the old behavior) races the SDK
// restoring a signed-in user from AsyncStorage: it would win that race and
// silently replace a real, already-persisted login with a throwaway
// anonymous one on every single cold start, which is what made staying
// signed in seem impossible. onAuthStateChanged's first callback reflects
// whatever session (real, anonymous, or none) the SDK already restored.
//
// authReady resolves once that initial check - and, if it fell through to
// the anonymous fallback, that sign-in too - is actually done, so
// request.auth is guaranteed non-null server-side by the time anything
// awaits it. Without this, a Firestore call made in the brief window
// before the fallback finishes (someone opening the app and immediately
// tapping Sign In, for instance) hits every rule's `request.auth != null`
// check as if signed out entirely - surfacing as a raw "Missing or
// insufficient permissions" error on something as simple as looking up a
// username, since nothing was gating that call on auth actually being
// ready yet.
let resolveAuthReady: () => void;
export const authReady: Promise<void> = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

const unsubscribeInitialAuthCheck = onAuthStateChanged(auth, (user) => {
  unsubscribeInitialAuthCheck();
  if (!user) {
    signInAnonymously(auth)
      .catch((e) => console.error("Anonymous sign-in error:", e))
      .finally(() => resolveAuthReady());
  } else {
    resolveAuthReady();
  }
});
