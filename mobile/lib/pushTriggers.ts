// Wires Boogie's genuinely-breaking-news posts (trades, fresh injuries -
// not the routine analyst posts, matching the "alerts are for real news"
// restraint real sports-news pushes use) to real device notifications for
// every league manager who's both linked a Fantasy Pulse account and
// opted in. Two real platform notes live in lib/pushNotifications.ts
// (EAS project id required, Expo Go doesn't support remote push since
// SDK 53) - this file is just the "who gets notified" and "send it" half.

import { collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./firebase";
import { sleeper, backend } from "./api";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** every league manager's push token, for managers who've linked a Fantasy Pulse account AND opted into push notifications - Firestore's "in" filter caps at 10 values, so a league bigger than that gets chunked. */
async function getLeaguePushTokens(leagueId: string): Promise<string[]> {
  const { data: users } = await sleeper.getLeagueUsers(leagueId);
  const sleeperUserIds: string[] = users.map((u: any) => u.user_id).filter(Boolean);
  if (sleeperUserIds.length === 0) return [];

  const tokens: string[] = [];
  await Promise.all(
    chunk(sleeperUserIds, 10).map(async (batch) => {
      const q = query(collection(db, "profiles"), where("sleeperUserId", "in", batch));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data() as { pushNotificationsEnabled?: boolean; pushToken?: string };
        if (data.pushNotificationsEnabled && data.pushToken) tokens.push(data.pushToken);
      }
    })
  );
  return tokens;
}

/** pushes a real breaking-news alert to every opted-in manager in this league - a no-op (not an error) if nobody in the league has push enabled yet. Never throws; a push failure should never block whatever real action (posting a trade, announcing an injury) triggered it. */
export async function notifyLeagueBreakingNews(
  leagueId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const tokens = await getLeaguePushTokens(leagueId);
    if (tokens.length === 0) return;
    await backend.sendPush(tokens, title, body, { leagueId, ...data });
  } catch (error) {
    console.error("Error notifying league of breaking news:", error);
  }
}
