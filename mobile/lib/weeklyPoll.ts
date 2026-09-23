import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { db } from "./firebase";
import { sleeper, backend, firestoreCollections } from "./api";
import getMatchupData from "./getMatchupData";
import { isPastMondayNightCutoff } from "./nflGameStatus";
import { getTeamLogo } from "./nflTeams";

export interface WeeklyPollOption {
  label: string;
  sublabel: string;
  avatar: string | null;
  isTeamLogo: boolean;
  votes: number;
  color: string;
}

export interface WeeklyPollDoc {
  leagueId: string;
  week: number;
  question: string;
  options: WeeklyPollOption[];
  createdAtMs: number;
}

const OPTION_COLORS = ["#af1222", "#3b82f6", "#eab308"];

function headshotFor(playerId: string, pos?: string, nflTeam?: string): { avatar: string | null; isTeamLogo: boolean } {
  if (pos === "DEF") return { avatar: getTeamLogo(nflTeam), isTeamLogo: true };
  return { avatar: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`, isTeamLogo: false };
}

// "Most recently finished" week - the current display week once its
// Monday night game has actually wrapped, otherwise the one before it
// (this week's still in progress or hasn't started). Same signal used
// everywhere else in this app to decide "is this week actually done."
export async function getLastCompletedWeek(): Promise<{ week: number; season: string }> {
  const { data: nflState } = await sleeper.getNflState();
  const displayWeek: number = nflState.display_week || 1;
  const week = Math.max(1, isPastMondayNightCutoff() ? displayWeek : displayWeek - 1);
  return { week, season: nflState.season };
}

/**
 * Real Week N MVP poll, built from this league's own actual results - each
 * team's single highest-scoring starter that week, ranked across the whole
 * league, top 3 as the ballot. Not a generic "who would you rather start"
 * question - this is retrospective, off real points already on the board,
 * and it's a different 2-3 names every week and every league, since it's
 * built from whatever actually happened.
 */
export async function buildWeeklyMvpPoll(leagueId: string, week: number): Promise<WeeklyPollDoc | null> {
  const playersData = await backend.fetchPlayers(leagueId).catch(() => ({}));
  const { updatedScheduleData } = await getMatchupData(leagueId, week, playersData);

  const candidates: { name: string; points: number; pos?: string; nflTeam?: string; teamName: string; playerId: string }[] = [];
  for (const teamData of Object.values(updatedScheduleData)) {
    let best: { id?: string; fn?: string; ln?: string; pos?: string; team?: string; points?: string } | null = null;
    let bestPoints = -Infinity;
    for (const s of teamData.starters_full_data ?? []) {
      if (!s.id || !s.fn || !s.ln) continue;
      const pts = parseFloat(s.points || "0");
      if (pts > bestPoints) {
        best = s;
        bestPoints = pts;
      }
    }
    if (best?.id && bestPoints > 0) {
      candidates.push({
        name: `${best.fn} ${best.ln}`,
        points: bestPoints,
        pos: best.pos,
        nflTeam: best.team,
        teamName: teamData.name,
        playerId: best.id,
      });
    }
  }

  candidates.sort((a, b) => b.points - a.points);
  const top = candidates.slice(0, 3);
  // Fewer than 2 real candidates means this week hasn't actually been
  // played yet (or the data isn't in) - no poll worth asking.
  if (top.length < 2) return null;

  return {
    leagueId,
    week,
    question: `Who was the real MVP of Week ${week}?`,
    options: top.map((c, i) => {
      const { avatar, isTeamLogo } = headshotFor(c.playerId, c.pos, c.nflTeam);
      return {
        label: c.name,
        sublabel: `${c.points.toFixed(1)} pts · ${c.teamName}`,
        avatar,
        isTeamLogo,
        votes: 0,
        color: OPTION_COLORS[i] ?? "#6b7280",
      };
    }),
    createdAtMs: Date.now(),
  };
}

/** Same poll for a given league+week every time it's asked for - built once, then reused (and voted on) by everyone until the next week's own poll replaces it. */
export async function getOrCreateWeeklyPoll(leagueId: string, week: number): Promise<WeeklyPollDoc | null> {
  const ref = doc(db, firestoreCollections.weeklyPoll, `${leagueId}_${week}`);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as WeeklyPollDoc;

  const built = await buildWeeklyMvpPoll(leagueId, week);
  if (!built) return null;
  await setDoc(ref, built);
  return built;
}

export async function voteOnWeeklyPoll(leagueId: string, week: number, options: WeeklyPollOption[]): Promise<void> {
  await setDoc(doc(db, firestoreCollections.weeklyPoll, `${leagueId}_${week}`), { options }, { merge: true });
}
