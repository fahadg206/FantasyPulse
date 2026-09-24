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

/** 76 -> `6'4"` - Sleeper's own raw height field is just inches as a string. */
export function formatHeight(rawInches: string | number | undefined): string | null {
  const inches = typeof rawInches === "number" ? rawInches : parseInt(rawInches || "", 10);
  if (!inches || Number.isNaN(inches)) return null;
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}
