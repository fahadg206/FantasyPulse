import type { Title } from "./profileActivity";

// Championships from before this platform existed (or from a league
// Sleeper's API otherwise can't see) aren't derivable from a crawl the way
// getCareerStats' real titles are - ProfileActivity's extraTitles prop
// accepts them directly, and this is that list, keyed by the app username
// (lowercase, matching normalizeUsername) they belong to. Add an entry
// here whenever someone asks for a title credited that the real crawl
// can't find on its own.
const MANUAL_TITLES: Record<string, Title[]> = {
  "123cancun": [{ leagueName: "Champions League", season: "2022" }],
  _fg: [{ leagueName: "Champions League", season: "2021" }],
};

export function getManualTitles(username: string): Title[] {
  return MANUAL_TITLES[username.trim().toLowerCase()] ?? [];
}
