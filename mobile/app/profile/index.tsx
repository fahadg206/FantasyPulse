import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import {
  onAuthChange,
  isReadOnly,
  signIn,
  signUp,
  signOutUser,
  getUserProfile,
  linkSleeperAccount,
  getUserProfileByUsername,
  requestPasswordReset,
  completeProfile,
  validateUsername,
  uploadAndSetAvatar,
  ensureAvatarSynced,
  UserProfile,
} from "../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../lib/fantasyProfile";
import { getFollowingUids, getFollowerUids } from "../../lib/follows";
import ProfileActivity from "../../components/ProfileActivity";
import { getManualTitles } from "../../lib/manualTitles";
import Avatar from "../../components/Avatar";

const CURRENT_SEASON = "2026";

export default function ProfileHome() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Distinguishes "haven't checked yet / still loading" from "checked, and
  // there really is no profile doc for this real signed-in user" - the
  // second case needs its own recovery UI, not a crash on a null profile.
  const [profileChecked, setProfileChecked] = useState(false);
  const [stats, setStats] = useState<FantasyProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [followCounts, setFollowCounts] = useState({ following: 0, followers: 0 });

  useEffect(() => onAuthChange((user) => {
    setAuthUser(user);
    setAuthChecked(true);
  }), []);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setProfile(null);
      setProfileChecked(false);
      return;
    }
    setProfileChecked(false);
    getUserProfile(authUser.uid)
      .then((p) => (p ? ensureAvatarSynced(p) : null))
      .then(setProfile)
      .catch((error) => {
        console.error(error);
        setProfile(null);
      })
      .finally(() => setProfileChecked(true));
  }, [authUser]);

  useEffect(() => {
    if (!profile) return;
    getFollowingUids(profile.uid).then((f) => setFollowCounts((c) => ({ ...c, following: f.length }))).catch(console.error);
    getFollowerUids(profile.uid).then((f) => setFollowCounts((c) => ({ ...c, followers: f.length }))).catch(console.error);
  }, [profile]);

  useEffect(() => {
    if (!profile?.sleeperUserId) {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    getFantasyProfileStats(profile.sleeperUserId, CURRENT_SEASON)
      .then(setStats)
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  }, [profile?.sleeperUserId]);

  if (!authChecked) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center">
        <ActivityIndicator color="#af1222" />
      </SafeAreaView>
    );
  }

  if (isReadOnly(authUser)) {
    return <SignInUpScreen />;
  }

  // A real signed-in user whose profile doc hasn't loaded yet.
  if (!profileChecked) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center">
        <ActivityIndicator color="#af1222" />
      </SafeAreaView>
    );
  }

  // A real signed-in user with no profile doc at all - an account whose
  // signup was interrupted after Auth succeeded but before its Firestore
  // profile got written (the scenario signUp's rollback now prevents going
  // forward, but this repairs any account already in that state).
  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e]">
        <ScrollView contentContainerClassName="px-5 pt-8 pb-12" showsVerticalScrollIndicator={false}>
          <CompleteProfileCard authUser={authUser!} onDone={setProfile} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.push("/")} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">Fantasy Profile</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="px-5 pt-8 pb-12" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View className="items-center mb-6">
            <AvatarUploadButton profile={profile} onUploaded={(avatar) => setProfile((p) => (p ? { ...p, avatar, avatarIsCustom: true } : p))} />
            <Text className="text-white text-[20px] font-bold mt-2">{profile?.displayName}</Text>
            <Text className="text-gray-500 text-[13px]">@{profile?.username}</Text>

          <View className="flex-row gap-6 mt-4">
            <Pressable
              onPress={() => router.push({ pathname: "/profile/connections", params: { username: profile.username, type: "following" } })}
              className="items-center"
            >
              <Text className="text-white font-bold text-[15px]">{followCounts.following}</Text>
              <Text className="text-gray-500 text-[11px]">Following</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: "/profile/connections", params: { username: profile.username, type: "followers" } })}
              className="items-center"
            >
              <Text className="text-white font-bold text-[15px]">{followCounts.followers}</Text>
              <Text className="text-gray-500 text-[11px]">Followers</Text>
            </Pressable>
          </View>
        </View>

        {!profile.sleeperUserId ? (
          <LinkSleeperCard
            uid={profile.uid}
            onLinked={() => getUserProfile(profile.uid).then(setProfile)}
          />
        ) : statsLoading ? (
          <ActivityIndicator color="#af1222" className="mt-6" />
        ) : stats ? (
          <ProfileActivity
            sleeperUserId={profile.sleeperUserId}
            stats={stats}
            extraTitles={getManualTitles(profile.username)}
          />
        ) : null}

        <FindManagerCard />

        <Pressable
          onPress={() => signOutUser()}
          className="flex-row items-center justify-center gap-2 mt-8 py-3 rounded-2xl border border-white/10"
        >
          <Feather name="log-out" size={16} color="#9ca3af" />
          <Text className="text-gray-400 font-semibold">Sign Out</Text>
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CompleteProfileCard({ authUser, onDone }: { authUser: User; onDone: (profile: UserProfile) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const validationError = validateUsername(username);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const profile = await completeProfile(authUser, username, displayName);
      onDone(profile);
    } catch (e: any) {
      setError(e.message || "Couldn't finish setting up your profile.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="bg-[#141416] rounded-2xl border border-white/10 p-4">
      <Text className="text-white font-bold text-[16px] mb-1">Finish setting up your profile</Text>
      <Text className="text-gray-500 text-[12px] mb-4">
        You're signed in as {authUser.email}, but your profile wasn't finished. Pick a username to continue.
      </Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white mb-2.5"
      />
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Display name (optional)"
        placeholderTextColor="#6b7280"
        className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white mb-2.5"
      />
      {error && <Text className="text-red-400 text-[12px] mb-2">{error}</Text>}
      <Pressable onPress={submit} disabled={loading} className="bg-brand rounded-xl py-2.5 items-center">
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Continue</Text>}
      </Pressable>
      <Pressable onPress={() => signOutUser()} className="items-center py-3 mt-1">
        <Text className="text-gray-500 text-[12px]">Sign out instead</Text>
      </Pressable>
    </View>
  );
}

function AvatarUploadButton({ profile, onUploaded }: { profile: UserProfile; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async () => {
    setError(null);
    setUploading(true);
    try {
      const url = await uploadAndSetAvatar(profile.uid);
      if (url) onUploaded(url);
    } catch (e: any) {
      setError(e.message || "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View className="items-center">
      <Pressable onPress={onPress} disabled={uploading} className="relative">
        <Avatar uid={profile.uid} url={profile.avatar} name={profile.displayName} size={80} />
        <View className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-brand items-center justify-center border-2 border-[#0c0c0e]">
          {uploading ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="camera" size={13} color="#fff" />}
        </View>
      </Pressable>
      {error && <Text className="text-red-400 text-[11px] mt-1.5">{error}</Text>}
    </View>
  );
}

function LinkSleeperCard({ uid, onLinked }: { uid: string; onLinked: () => void }) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await linkSleeperAccount(uid, username.trim());
      onLinked();
    } catch (e: any) {
      setError(e.message || "Couldn't link that account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="bg-[#141416] rounded-2xl border border-white/10 p-4">
      <Text className="text-white font-bold text-[14px] mb-1">Link Your Sleeper Account</Text>
      <Text className="text-gray-500 text-[12px] mb-3">
        Connect your Sleeper username to show your stats across all your leagues this season.
      </Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Sleeper username"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white mb-2.5"
      />
      {error && <Text className="text-red-400 text-[12px] mb-2">{error}</Text>}
      <Pressable
        onPress={submit}
        disabled={loading}
        className="bg-brand rounded-xl py-2.5 items-center"
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Link Account</Text>}
      </Pressable>
    </View>
  );
}

function FindManagerCard() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exact-username lookup, not a real search index (Firestore has no
  // full-text search built in, and standing up Algolia or similar is out
  // of scope here) - a reasonable MVP for "find and follow a specific
  // manager you already know", not for browsing/discovery.
  const submit = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const target = await getUserProfileByUsername(username.trim());
      if (!target) {
        setError("No manager found with that username.");
        return;
      }
      router.push(`/profile/${target.username}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mt-4">
      <Text className="text-white font-bold text-[14px] mb-1">Find a Manager</Text>
      <Text className="text-gray-500 text-[12px] mb-3">
        Look up another manager by their exact username to view their profile and follow them.
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          placeholderTextColor="#6b7280"
          autoCapitalize="none"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white"
        />
        <Pressable
          onPress={submit}
          disabled={loading}
          className="bg-white/10 rounded-xl px-4 items-center justify-center"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Feather name="search" size={16} color="#fff" />}
        </Pressable>
      </View>
      {error && <Text className="text-red-400 text-[12px] mt-2">{error}</Text>}
    </View>
  );
}

function SignInUpScreen() {
  const [mode, setMode] = useState<"signin" | "signup" | "recover">("signin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === "recover") {
    return <ForgotAccountFlow onDone={() => setMode("signin")} />;
  }

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signUp(username, password, email, displayName);
      } else {
        await signIn(username, password);
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow px-6 justify-center" keyboardShouldPersistTaps="handled">
          <View className="items-center mb-8">
            <View className="w-[56px] h-[56px] rounded-full bg-brand/20 items-center justify-center mb-3">
              <Feather name="user" size={24} color="#e2465a" />
            </View>
            <Text className="text-white text-[22px] font-bold">
              {mode === "signup" ? "Create Your Profile" : "Sign In"}
            </Text>
            <Text className="text-gray-500 text-[13px] mt-1 text-center px-4">
              You're browsing read-only. Sign in with your username and password to follow
              managers, comment on matchups and trades, and post to the feed.
            </Text>
          </View>

          {mode === "signup" && (
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor="#6b7280"
              className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
            />
          )}
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder={mode === "signup" ? "Sleeper username" : "Sleeper username or email"}
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
          />
          {mode === "signup" && (
            <Text className="text-gray-600 text-[11px] mb-2.5 px-1">
              This becomes your @handle here too, and links your Sleeper account automatically.
            </Text>
          )}
          {mode === "signup" && (
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
            />
          )}
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#6b7280"
            secureTextEntry
            className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
          />
          {mode === "signup" && (
            <Text className="text-gray-600 text-[11px] mb-2.5 px-1">
              Your email is only used to sign in and to recover your account if you ever forget
              your username or password.
            </Text>
          )}

          {error && <Text className="text-red-400 text-[13px] mb-2">{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={
              loading || !username.trim() || !password || (mode === "signup" && !email.trim())
            }
            className="bg-brand rounded-xl py-3.5 items-center mt-2"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-bold text-[15px]">
                {mode === "signup" ? "Create Account" : "Sign In"}
              </Text>
            )}
          </Pressable>

          {mode === "signin" && (
            <Pressable onPress={() => setMode("recover")} className="items-center mt-4">
              <Text className="text-gray-400 text-[13px]">Forgot your username or password?</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
            }}
            className="items-center mt-4"
          >
            <Text className="text-gray-400 text-[13px]">
              {mode === "signup" ? "Already have an account? " : "New here? "}
              <Text className="text-brand font-semibold">
                {mode === "signup" ? "Sign In" : "Create One"}
              </Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ForgotAccountFlow({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (e: any) {
      setError(e.message || "Couldn't send that right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-3">
        <Pressable onPress={onDone} hitSlop={10}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow px-6 justify-center" keyboardShouldPersistTaps="handled">
          <View className="items-center mb-6">
            <View className="w-[56px] h-[56px] rounded-full bg-brand/20 items-center justify-center mb-3">
              <Feather name="mail" size={24} color="#e2465a" />
            </View>
            <Text className="text-white text-[20px] font-bold">Forgot Your Account?</Text>
            <Text className="text-gray-500 text-[13px] mt-1 text-center px-4">
              {sent
                ? `If an account uses ${email}, a reset link is on its way. Follow it, set a new password, then sign back in with this email - your username shows right in the app.`
                : "Enter the email you signed up with. We'll send a link to set a new password."}
            </Text>
          </View>

          {!sent ? (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
              />
              {error && <Text className="text-red-400 text-[13px] mb-2">{error}</Text>}
              <Pressable
                onPress={send}
                disabled={loading || !email.trim()}
                className="bg-brand rounded-xl py-3.5 items-center mt-2"
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-[15px]">Send Reset Link</Text>
                )}
              </Pressable>
            </>
          ) : (
            <Pressable onPress={onDone} className="bg-brand rounded-xl py-3.5 items-center">
              <Text className="text-white font-bold text-[15px]">Back to Sign In</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
