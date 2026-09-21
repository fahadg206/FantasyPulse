import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  deleteUser,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { auth, db } from "./firebase";

// Real accounts, on top of the app-wide anonymous session that already
// exists in firebase.ts (kept as-is for the existing poll/article features
// that just need "some" authenticated request). Real password
// hashing/storage is entirely Firebase's job; nothing here ever touches a
// raw password beyond handing it to the SDK.
//
// A real email is the actual Firebase Auth identifier (no synthetic email
// trick), so account recovery can ride entirely on Firebase's own built-in
// password-reset email - free, sent from Firebase's own infrastructure,
// no third-party service or backend route needed at all. Signing in
// accepts either the username or the email; if someone forgets their
// username, resetting their password by email and signing back in with
// that email (shown right in the app afterward, alongside their username)
// solves it without needing a separate "remind me of my username" flow.
// (This replaces an earlier phone-number/SMS design - see git history -
// dropped once a free option surfaced that needed no new infrastructure.)
//
// "Read-only" (the app's default, unauthenticated state) means the current
// user is either null or still on the anonymous session - see isReadOnly.

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  email: string;
  sleeperUsername?: string;
  sleeperUserId?: string;
  bio?: string;
  avatar?: string;
  createdAt: string;
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(normalizeUsername(username))) {
    return "Usernames are 3-20 characters: letters, numbers, and underscores only.";
  }
  return null;
}

export function validateEmail(email: string): string | null {
  if (!EMAIL_PATTERN.test(normalizeEmail(email))) {
    return "Enter a valid email address.";
  }
  return null;
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "usernames", normalizeUsername(username)));
  return snap.exists();
}

export async function signUp(
  username: string,
  password: string,
  email: string,
  displayName?: string
): Promise<UserProfile> {
  const normalizedUsername = normalizeUsername(username);
  const usernameError = validateUsername(normalizedUsername);
  if (usernameError) throw new Error(usernameError);
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const normalizedEmail = normalizeEmail(email);
  const emailError = validateEmail(normalizedEmail);
  if (emailError) throw new Error(emailError);

  if (await isUsernameTaken(normalizedUsername)) {
    throw new Error("That username is already taken.");
  }

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  } catch (error: any) {
    if (error?.code === "auth/email-already-in-use") {
      throw new Error("That email is already registered.");
    }
    throw error;
  }

  const profile: UserProfile = {
    uid: credential.user.uid,
    username: normalizedUsername,
    displayName: displayName?.trim() || normalizedUsername,
    email: normalizedEmail,
    createdAt: new Date().toISOString(),
  };

  // The Auth account and its Firestore profile doc have to end up in sync -
  // if the Firestore writes fail (rules misconfigured, network drop,
  // whatever), roll back the just-created Auth account rather than leaving
  // an orphaned account with no profile behind: that account would then be
  // stuck forever, since re-running signUp with the same email always fails
  // with "email already registered" but there'd be no profile to recover
  // via completeProfile (its username was never reserved either).
  try {
    await setDoc(doc(db, "profiles", credential.user.uid), profile);
    await setDoc(doc(db, "usernames", normalizedUsername), { uid: credential.user.uid });
  } catch (error) {
    await deleteUser(credential.user).catch(() => {});
    throw error;
  }

  return profile;
}

/**
 * Finishes setting up an account that already has a real Firebase Auth
 * user but no profile doc yet - the recovery path for any account that
 * predates the deleteUser rollback above (an orphaned Auth account whose
 * profile/username writes failed silently before that safeguard existed).
 * Shown automatically by the profile screen whenever a real signed-in user
 * has no matching profiles/{uid} doc.
 */
export async function completeProfile(user: User, username: string, displayName?: string): Promise<UserProfile> {
  const normalizedUsername = normalizeUsername(username);
  const usernameError = validateUsername(normalizedUsername);
  if (usernameError) throw new Error(usernameError);
  if (await isUsernameTaken(normalizedUsername)) {
    throw new Error("That username is already taken.");
  }

  const profile: UserProfile = {
    uid: user.uid,
    username: normalizedUsername,
    displayName: displayName?.trim() || normalizedUsername,
    email: normalizeEmail(user.email ?? ""),
    createdAt: new Date().toISOString(),
  };

  await setDoc(doc(db, "profiles", user.uid), profile);
  await setDoc(doc(db, "usernames", normalizedUsername), { uid: user.uid });

  return profile;
}

export async function signIn(usernameOrEmail: string, password: string): Promise<UserProfile> {
  const trimmed = usernameOrEmail.trim();
  let email: string;

  if (trimmed.includes("@")) {
    email = normalizeEmail(trimmed);
  } else {
    const existing = await getUserProfileByUsername(trimmed);
    if (!existing) throw new Error("No account found with that username.");
    email = existing.email;
  }

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getUserProfile(credential.user.uid);
  if (!profile) throw new Error("Account found, but its profile is missing.");
  return profile;
}

/** Firebase's own built-in reset email - free, no third-party service. Solves both "forgot password" and "forgot username" (sign back in with the email afterward, and the username shows right in the app). */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const emailError = validateEmail(normalized);
  if (emailError) throw new Error(emailError);
  try {
    await sendPasswordResetEmail(auth, normalized);
  } catch (error: any) {
    // Don't reveal whether an account exists for this email - same
    // outcome either way, matching how the rest of this app's recovery
    // flow treats unregistered input.
    if (error?.code === "auth/user-not-found") return;
    throw error;
  }
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
