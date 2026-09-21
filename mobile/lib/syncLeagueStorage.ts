import { ref, getDownloadURL } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";
import { auth, storage, storageBucket } from "./firebase";
import { sleeper, backend } from "./api";
import getMatchupData, { MatchupMapData, ScheduleData, Starter } from "./getMatchupData";

// Ports `updateDbStorage` from the web app's Scoreboard.tsx. The AI-content
// endpoints (fetchHeadlines, fetchPreview, fetchPlayoffPredictions) read
// their league context from two Firebase Storage text files that only the
// web app used to write. Since the web-only `Scoreboard` side effect was
// intentionally dropped during the mobile port, any league visited only
// from mobile never gets these files created, so those endpoints throw
// before their own try/catch and the app falls back to default content.
// This restores the write so mobile-only leagues get real AI content too.

function stripMatchupTeam(team: Partial<ScheduleData[string]>) {
  delete team.starters;
  delete team.starters_points;
  delete team.players;
  delete team.players_points;
  delete team.roster_id;
  delete team.user_id;
  delete team.avatar;
  if (team.starters_full_data) {
    for (const starter of team.starters_full_data as Partial<Starter>[]) {
      delete starter.avatar;
      delete starter.proj;
    }
  }
}

function stripPreviewEntry(entry: Partial<ScheduleData[string]>) {
  delete entry.starters;
  delete entry.starters_points;
  delete entry.players;
  delete entry.players_points;
  delete entry.roster_id;
  delete entry.user_id;
  delete entry.avatar;
  if (entry.starters_full_data) {
    for (const starter of entry.starters_full_data as Partial<Starter>[]) {
      delete starter.avatar;
      delete starter.points;
    }
  }
}

// firebase/storage's uploadString/uploadBytes build a Blob from an
// ArrayBuffer internally, which React Native's Blob polyfill doesn't
// support ("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not
// supported") - every upload from mobile fails silently as a result.
// Uploading directly via the Storage REST API with a plain string body
// sidesteps that broken code path entirely (reads via getDownloadURL are
// unaffected and still use the SDK below).
async function getAuthToken(): Promise<string | null> {
  if (auth.currentUser) return auth.currentUser.getIdToken();
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user ? user.getIdToken() : null);
    });
    setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, 8000);
  });
}

async function uploadNewContent(content: string, path: string) {
  try {
    const token = await getAuthToken();
    const url = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: content,
    });
    if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  } catch (error) {
    console.error("Error uploading league storage file:", error);
  }
}

async function addContentIfDifferent(newContent: string, path: string) {
  if (newContent.length <= 3) return;
  try {
    const url = await getDownloadURL(ref(storage, path));
    const existingContent = await fetch(url).then((r) => r.text());
    if (!existingContent || existingContent !== newContent) {
      await uploadNewContent(newContent, path);
    }
  } catch (error: any) {
    if (error?.code === "storage/object-not-found") {
      await uploadNewContent(newContent, path);
    }
  }
}

export async function syncLeagueStorageFiles(leagueId: string) {
  try {
    const { data: nflState } = await sleeper.getNflState();
    const week: number = nflState.week ?? nflState.display_week ?? 1;
    const displayWeek: number = nflState.display_week ?? week;

    const midWeek = displayWeek !== week;
    const weeklyWeek = midWeek ? displayWeek : Math.max(1, week - 1);
    const previewWeek = midWeek ? displayWeek + 1 : displayWeek;

    const playersData = await backend.fetchPlayers(leagueId);
    const [weeklyResult, previewResult] = await Promise.all([
      getMatchupData(leagueId, weeklyWeek, playersData),
      getMatchupData(leagueId, previewWeek, playersData),
    ]);

    const weeklyData: Record<string, MatchupMapData[]> = Object.fromEntries(weeklyResult.matchupMap);
    for (const matchupId in weeklyData) {
      for (const team of weeklyData[matchupId]) {
        stripMatchupTeam(team as Partial<ScheduleData[string]>);
      }
    }

    const previewScheduleData: ScheduleData = JSON.parse(JSON.stringify(previewResult.updatedScheduleData));
    for (const userId in previewScheduleData) {
      stripPreviewEntry(previewScheduleData[userId]);
    }

    const weeklyContent = JSON.stringify(weeklyData);
    const previewContent = JSON.stringify(Object.values(previewScheduleData));

    await Promise.all([
      addContentIfDifferent(weeklyContent, `files/${leagueId}.txt`),
      addContentIfDifferent(previewContent, `files/${leagueId}_preview.txt`),
    ]);
  } catch (error) {
    console.error("Error syncing league storage files:", error);
  }
}
