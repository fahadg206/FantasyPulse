// Real player bio data (age, height, weight, experience) for the player
// detail card's header - Sleeper's full, unfiltered /players/nfl feed,
// same cache key ("sleeper-all-players-nfl") lib/profileActivity.ts's own
// resolveRetiredOrInactivePlayer already uses, so the two share one fetch
// of this ~5MB payload instead of pulling it twice. This app's own
// /api/fetchPlayers is scoped to a league's current rosters and only
// players with a real current NFL team - the wrong shape for "look up any
// one player's real bio," which is the one thing this file is for.

import { cachedFetch } from "./requestCache";

const ALL_PLAYERS_TTL_MS = 24 * 60 * 60 * 1000; // this list barely changes day to day

export interface PlayerBio {
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  number?: number;
  age?: number;
  height?: string; // raw inches, as a string
  weight?: string; // lbs, as a string
  years_exp?: number;
  college?: string;
  status?: string;
  /** Sleeper's real injury designation (Questionable/Doubtful/Out/IR/PUP/Sus/...) - absent/null means no current designation, not necessarily 100% healthy. Already present on every object this file's own bulk fetch pulls back; just wasn't typed/used until now. */
  injury_status?: string;
  /** this player's real id on ESPN's own platform - Sleeper's own database carries every major platform's cross-reference id (espn_id, yahoo_id, ...) so matching a player across providers never needs fuzzy name matching. */
  espn_id?: number;
  yahoo_id?: number;
}

export async function getAllPlayersData(): Promise<Record<string, PlayerBio>> {
  return cachedFetch("sleeper-all-players-nfl", ALL_PLAYERS_TTL_MS, async () => {
    const res = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!res.ok) throw new Error(`Sleeper players/nfl request failed: ${res.status}`);
    return res.json();
  });
}

export async function getPlayerBio(playerId: string): Promise<PlayerBio | null> {
  try {
    const all = await getAllPlayersData();
    return all[playerId] ?? null;
  } catch (error) {
    console.error(`Error loading player bio for ${playerId}:`, error);
    return null;
  }
}

const INJURY_ABBREV: Record<string, string> = { Questionable: "Q", Doubtful: "D", Out: "O", IR: "IR", PUP: "PUP", Sus: "SUS", NA: "NA" };
/** real Sleeper injury designation -> a short badge label + severity color, shared by every screen that shows a player card or the player detail header - one mapping so "Doubtful" reads the same everywhere. null for anything falsy (no current designation). */
export function injuryBadge(status: string | undefined | null): { label: string; color: string } | null {
  if (!status) return null;
  const label = INJURY_ABBREV[status] ?? status.slice(0, 3).toUpperCase();
  const color = status === "Questionable" ? "#eab308" : status === "Doubtful" ? "#f97316" : "#ef4444";
  return { label, color };
}

/** 76 -> `6'4"` - Sleeper's own raw height field is just inches as a string. */
export function formatHeight(rawInches: string | number | undefined): string | null {
  const inches = typeof rawInches === "number" ? rawInches : parseInt(rawInches || "", 10);
  if (!inches || Number.isNaN(inches)) return null;
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}
