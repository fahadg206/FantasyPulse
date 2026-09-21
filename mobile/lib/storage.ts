import AsyncStorage from "@react-native-async-storage/async-storage";

// Thin wrapper so screens don't hand-roll try/catch around every AsyncStorage
// call. Mirrors the localStorage keys the web app uses.
export const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJSON: (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value)),

  async clearLeagueSelection() {
    await AsyncStorage.multiRemove([
      "selectedLeagueID",
      "selectedLeagueName",
      "leagueStatus",
      "usernameSubmitted",
      "progressValue",
    ]);
  },

  // Clears only per-week vote-lock keys (`${leagueId} ${matchupId} userVoted`)
  // when the NFL week has advanced. The web app calls localStorage.clear()
  // here, which also wipes the selected league - that looks like a bug, not
  // intended behavior, so this only removes the stale vote-lock keys.
  async clearStaleVoteLocks() {
    const keys = await AsyncStorage.getAllKeys();
    const staleKeys = keys.filter((k) => k.endsWith(" userVoted"));
    if (staleKeys.length) await AsyncStorage.multiRemove(staleKeys);
  },
};

export const StorageKeys = {
  selectedLeagueID: "selectedLeagueID",
  selectedLeagueName: "selectedLeagueName",
  leagueStatus: "leagueStatus",
  usernames: "usernames",
  usernameSubmitted: "usernameSubmitted",
  progressValue: "progressValue",
  currentWeek: "currentWeek",
  voteLock: (leagueId: string, matchupId: string) => `${leagueId} ${matchupId} userVoted`,
} as const;
