import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { auth, db } from "./firebase";
import { backend } from "./api";

// Real accounts, on top of the app-wide anonymous session that already
// exists in firebase.ts (kept as-is for the existing poll/article features
// that just need "some" authenticated request). Firebase Auth's native
// identifier is an email, but the ask was a username/password login - so a
// chosen username maps to a synthetic "<username>@fantasypulse.app"
// address under the hood, tracked via a usernames/{lowercaseUsername}
// lookup doc. Real password hashing/storage is entirely Firebase's job;
// nothing here ever touches a raw password beyond handing it to the SDK.
//
// "Read-only" (the app's default, unauthenticated state) means the current
// user is either null or still on the anonymous session - see isReadOnly.

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  phoneNumber?: string;
  sleeperUsername?: string;
  sleeperUserId?: string;
  bio?: string;
  avatar?: string;
  createdAt: string;
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function syntheticEmail(username: string): string {
  return `${username}@fantasypulse.app`;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(normalizeUsername(username))) {
    return "Usernames are 3-20 characters: letters, numbers, and underscores only.";
  }
  return null;
}

// Mirrors the same normalization in sendUsernameRecoveryOtp.js /
// verifyUsernameRecoveryOtp.js server-side, so a number entered at signup
// resolves to the same key a later recovery lookup uses. Assumes a US
// number when no country code is given - this app's audience is US-based
// fantasy football leagues.
export function normalizePhoneNumber(raw: string): string {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return `+${bare}`;
}

export function validatePhoneNumber(raw: string): string | null {
  const normalized = normalizePhoneNumber(raw);
  if (!/^\+\d{10,15}$/.test(normalized)) {
    return "Enter a valid phone number, e.g. (555) 123-4567.";
  }
  return null;
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "usernames", normalizeUsername(username)));
  return snap.exists();
}

export async function isPhoneNumberTaken(phoneNumber: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "phoneNumbers", normalizePhoneNumber(phoneNumber)));
  return snap.exists();
}

export async function signUp(
  username: string,
  password: string,
  phoneNumber: string,
  displayName?: string
): Promise<UserProfile> {
  const normalized = normalizeUsername(username);
  const validationError = validateUsername(normalized);
  if (validationError) throw new Error(validationError);
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const phoneError = validatePhoneNumber(phoneNumber);
  if (phoneError) throw new Error(phoneError);

  if (await isUsernameTaken(normalized)) throw new Error("That username is already taken.");
  if (await isPhoneNumberTaken(normalizedPhone)) {
    throw new Error("That phone number is already linked to an account.");
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    syntheticEmail(normalized),
    password
  );

  const profile: UserProfile = {
    uid: credential.user.uid,
    username: normalized,
    displayName: displayName?.trim() || normalized,
    phoneNumber: normalizedPhone,
    createdAt: new Date().toISOString(),
  };

  await setDoc(doc(db, "profiles", credential.user.uid), profile);
  await setDoc(doc(db, "usernames", normalized), { uid: credential.user.uid });
  await setDoc(doc(db, "phoneNumbers", normalizedPhone), { uid: credential.user.uid });

  return profile;
}

/** step 1 of "forgot your username": request an SMS code be sent to this phone number */
export async function sendUsernameRecoveryCode(phoneNumber: string): Promise<void> {
  await backend.sendUsernameRecoveryOtp(normalizePhoneNumber(phoneNumber));
}

/** step 2: verify the code and get back the username tied to this phone number, if any */
export async function verifyUsernameRecoveryCode(
  phoneNumber: string,
  code: string
): Promise<string> {
  const { username } = await backend.verifyUsernameRecoveryOtp(
    normalizePhoneNumber(phoneNumber),
    code
  );
  return username;
}

export async function signIn(username: string, password: string): Promise<UserProfile> {
  const normalized = normalizeUsername(username);
  const credential = await signInWithEmailAndPassword(
    auth,
    syntheticEmail(normalized),
    password
  );
  const profile = await getUserProfile(credential.user.uid);
  if (!profile) throw new Error("Account found, but its profile is missing.");
  return profile;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function getUserProfileByUsername(username: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "usernames", normalizeUsername(username)));
  if (!snap.exists()) return null;
  const { uid } = snap.data() as { uid: string };
  return getUserProfile(uid);
}

export async function updateProfile(
  uid: string,
  updates: Partial<Pick<UserProfile, "displayName" | "bio" | "avatar">>
): Promise<void> {
  await setDoc(doc(db, "profiles", uid), updates, { merge: true });
}

/** links this app account to a real Sleeper account, for the Fantasy Profile's cross-league stats */
export async function linkSleeperAccount(uid: string, sleeperUsername: string): Promise<void> {
  const res = await fetch(`https://api.sleeper.app/v1/user/${sleeperUsername.trim()}`);
  if (!res.ok) throw new Error("Couldn't find that Sleeper username.");
  const sleeperUser = await res.json();
  if (!sleeperUser?.user_id) throw new Error("Couldn't find that Sleeper username.");
  await setDoc(
    doc(db, "profiles", uid),
    { sleeperUsername: sleeperUser.username ?? sleeperUsername.trim(), sleeperUserId: sleeperUser.user_id },
    { merge: true }
  );
}

/** true when there's no real (non-anonymous) signed-in user - the app's default, read-only state */
export function isReadOnly(user: User | null): boolean {
  return !user || user.isAnonymous;
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}
