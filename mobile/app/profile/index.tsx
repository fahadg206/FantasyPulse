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
  sendUsernameRecoveryCode,
  verifyUsernameRecoveryCode,
  UserProfile,
} from "../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../lib/fantasyProfile";
import { getFollowingUids, getFollowerUids } from "../../lib/follows";

const CURRENT_SEASON = "2026";

export default function ProfileHome() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
      return;
    }
    getUserProfile(authUser.uid).then(setProfile).catch(console.error);
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

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <ScrollView contentContainerClassName="px-5 pt-8 pb-12" showsVerticalScrollIndicator={false}>
        <View className="items-center mb-6">
          <View className="w-[76px] h-[76px] rounded-full bg-brand/20 items-center justify-center mb-2">
            <Text className="text-brand text-[28px] font-bold">
              {(profile?.displayName || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text className="text-white text-[20px] font-bold">{profile?.displayName}</Text>
          <Text className="text-gray-500 text-[13px]">@{profile?.username}</Text>

          <View className="flex-row gap-6 mt-4">
            <View className="items-center">
              <Text className="text-white font-bold text-[15px]">{followCounts.following}</Text>
              <Text className="text-gray-500 text-[11px]">Following</Text>
            </View>
            <View className="items-center">
              <Text className="text-white font-bold text-[15px]">{followCounts.followers}</Text>
              <Text className="text-gray-500 text-[11px]">Followers</Text>
            </View>
          </View>
        </View>

        {!profile?.sleeperUserId ? (
          <LinkSleeperCard
            uid={profile!.uid}
            onLinked={() => getUserProfile(profile!.uid).then(setProfile)}
          />
        ) : statsLoading ? (
          <ActivityIndicator color="#af1222" className="mt-6" />
        ) : stats ? (
          <FantasyProfileStatsView stats={stats} />
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
    </SafeAreaView>
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

function FantasyProfileStatsView({ stats }: { stats: FantasyProfileStats }) {
  return (
    <View>
      <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mb-4">
        <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2">
          {stats.season} SEASON - {stats.totals.leaguesCount} LEAGUES
        </Text>
        <View className="flex-row justify-between">
          <StatBlock label="Record" value={`${stats.totals.wins}-${stats.totals.losses}`} />
          <StatBlock label="Points For" value={stats.totals.pointsFor.toFixed(0)} />
          <StatBlock
            label="Win %"
            value={
              stats.totals.wins + stats.totals.losses > 0
                ? `${((stats.totals.wins / (stats.totals.wins + stats.totals.losses)) * 100).toFixed(0)}%`
                : "-"
            }
          />
        </View>
      </View>

      <Text className="text-white font-bold text-[14px] mb-2">By League</Text>
      {stats.leagues.map((l) => (
        <View
          key={l.leagueId}
          className="flex-row items-center justify-between bg-[#141416] rounded-xl border border-white/10 px-4 py-3 mb-2"
        >
          <View className="flex-1 mr-2">
            <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
              {l.leagueName}
            </Text>
            <Text className="text-gray-500 text-[11px]">
              Rank #{l.rank} of {l.totalTeams}
            </Text>
          </View>
          <View className="items-end">
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
              {l.wins}-{l.losses}
            </Text>
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-500 text-[11px]">
              {l.pointsFor.toFixed(1)} pts
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[16px]">
        {value}
      </Text>
      <Text className="text-gray-500 text-[10px] mt-0.5">{label}</Text>
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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === "recover") {
    return <ForgotUsernameFlow onDone={() => setMode("signin")} />;
  }

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signUp(username, password, phoneNumber, displayName);
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
            placeholder="Username"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
          />
          {mode === "signup" && (
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="Phone number"
              placeholderTextColor="#6b7280"
              keyboardType="phone-pad"
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
              Your phone number is only used if you ever forget your username - we'll text a
              code to confirm it's you, then remind you.
            </Text>
          )}

          {error && <Text className="text-red-400 text-[13px] mb-2">{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={
              loading ||
              !username.trim() ||
              !password ||
              (mode === "signup" && !phoneNumber.trim())
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
              <Text className="text-gray-400 text-[13px]">Forgot your username?</Text>
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

function ForgotUsernameFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"phone" | "code" | "result">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [foundUsername, setFoundUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    if (!phoneNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await sendUsernameRecoveryCode(phoneNumber);
      setStep("code");
    } catch (e: any) {
      setError(e.message || "Couldn't send a code right now.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const username = await verifyUsernameRecoveryCode(phoneNumber, code.trim());
      setFoundUsername(username);
      setStep("result");
    } catch (e: any) {
      setError(e.message || "That code didn't work.");
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
              <Feather name="message-circle" size={24} color="#e2465a" />
            </View>
            <Text className="text-white text-[20px] font-bold">Forgot Your Username?</Text>
            <Text className="text-gray-500 text-[13px] mt-1 text-center px-4">
              {step === "phone" && "Enter the phone number you signed up with. We'll text you a code."}
              {step === "code" && `Enter the code we texted to ${phoneNumber}.`}
              {step === "result" && "Here's your username."}
            </Text>
          </View>

          {step === "phone" && (
            <>
              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="Phone number"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
                className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5"
              />
              {error && <Text className="text-red-400 text-[13px] mb-2">{error}</Text>}
              <Pressable
                onPress={sendCode}
                disabled={loading || !phoneNumber.trim()}
                className="bg-brand rounded-xl py-3.5 items-center mt-2"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[15px]">Send Code</Text>}
              </Pressable>
            </>
          )}

          {step === "code" && (
            <>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor="#6b7280"
                keyboardType="number-pad"
                maxLength={6}
                className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-white mb-2.5 text-center text-[18px] tracking-widest"
              />
              {error && <Text className="text-red-400 text-[13px] mb-2">{error}</Text>}
              <Pressable
                onPress={verifyCode}
                disabled={loading || !code.trim()}
                className="bg-brand rounded-xl py-3.5 items-center mt-2"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[15px]">Verify</Text>}
              </Pressable>
              <Pressable onPress={() => setStep("phone")} className="items-center mt-4">
                <Text className="text-gray-400 text-[13px]">Use a different number</Text>
              </Pressable>
            </>
          )}

          {step === "result" && (
            <>
              <View className="bg-[#141416] rounded-2xl border border-white/10 p-5 items-center mb-4">
                <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-1">YOUR USERNAME</Text>
                <Text className="text-white text-[22px] font-bold">@{foundUsername}</Text>
              </View>
              <Pressable onPress={onDone} className="bg-brand rounded-xl py-3.5 items-center">
                <Text className="text-white font-bold text-[15px]">Back to Sign In</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
