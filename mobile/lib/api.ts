import axios from "axios";
import { cachedFetch } from "./requestCache";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

// League settings, scoring rules, and the users list are effectively
// static for the whole session - the same league fetched from five
// different screens in one sitting doesn't need five separate round trips.
// Rosters get a much shorter TTL since settings.wins/losses/fpts do change
// (once a week finalizes) - short enough to still dedupe a fast tab
// switch, long enough that it's never the thing making a screen feel
// stale. Matchups and the current NFL week are deliberately left
// uncached below - those are exactly the live-scoring data that must
// never be stale.
const LEAGUE_META_TTL_MS = 10 * 60 * 1000;
const ROSTERS_TTL_MS = 2 * 60 * 1000;

export const sleeper = {
  getUser: (username: string) => axios.get(`${SLEEPER_BASE}/user/${username}`),
  getUserLeagues: (userId: string, season: string) =>
    axios.get(`${SLEEPER_BASE}/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId: string) =>
    cachedFetch(`league:${leagueId}`, LEAGUE_META_TTL_MS, () => axios.get(`${SLEEPER_BASE}/league/${leagueId}`)),
  getLeagueUsers: (leagueId: string) =>
    cachedFetch(`league-users:${leagueId}`, LEAGUE_META_TTL_MS, () =>
      axios.get(`${SLEEPER_BASE}/league/${leagueId}/users`)
    ),
  getLeagueRosters: (leagueId: string) =>
    cachedFetch(`league-rosters:${leagueId}`, ROSTERS_TTL_MS, () =>
      axios.get(`${SLEEPER_BASE}/league/${leagueId}/rosters`)
    ),
  getMatchups: (leagueId: string, week: number) =>
    axios.get(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`),
  getNflState: () => axios.get(`${SLEEPER_BASE}/state/nfl`),
};

// The Next.js API routes (src/pages/api/*) stay deployed on the existing web
// app; the mobile app calls them the same way the web app's own client
// components do. NOT localhost — see articles/page.tsx's fixed bug.
export const APP_ORIGIN = "https://www.fantasypulseff.com";

export const backend = {
  // By far the heaviest single request in the app (the full league-scoped
  // player payload, names/positions/teams/weekly projections for
  // thousands of players) and, before this cache, also the most
  // frequently repeated - nearly every screen calls this for the same
  // league. Player identity/position/team and this week's projections
  // don't shift minute to minute, so a 10-minute cache costs nothing in
  // staleness and removes what was often the single slowest thing a
  // screen was waiting on.
  fetchPlayers: (leagueId: string) =>
    cachedFetch(`players:${leagueId}`, LEAGUE_META_TTL_MS, () =>
      fetch(`${APP_ORIGIN}/api/fetchPlayers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      }).then((r) => r.json())
    ),

  // Sending a raw string as the body with no Content-Type left it up to
  // each runtime to guess how to encode it - on-device this occasionally
  // produced a body Next's parser couldn't turn back into a plain string
  // (crashing the handler with "Cannot convert object to primitive
  // value"). Sending real JSON with an explicit header, like fetchPlayers
  // already does, removes the ambiguity entirely.
  fetchPreview: (leagueId: string) =>
    fetch(`${APP_ORIGIN}/api/fetchPreview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    }).then((r) => r.json()),
  fetchWelcome: (leagueId: string) =>
    fetch(`${APP_ORIGIN}/api/fetchWelcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    }).then((r) => r.json()),
  fetchPlayoffPredictions: (leagueId: string) =>
    fetch(`${APP_ORIGIN}/api/fetchPlayoffPredictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    }).then((r) => r.json()),

  // `leagueSettings` (lib/playerValue.ts's LeagueValueSettings) gives the
  // real format-aware value - superflex, TE premium, PPR level, passing-TD
  // points all actually affect a real KTC-derived value, most obviously
  // superflex QBs. `scoringType` is the older back-compat path (draft.tsx's
  // grading, which doesn't need per-format precision) - pass one or the
  // other, not both.
  fetchPlayerValue: (
    sleeperId: string,
    scoringType: string,
    leagueSettings?: import("./playerValue").LeagueValueSettings
  ): Promise<{ value: number }> =>
    fetch(`${APP_ORIGIN}/api/fetchPlayerValues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leagueSettings ? { sleeperId, leagueSettings } : { sleeperId, scoringType }),
    }).then((r) => r.json()),

  fetchHeadlines: (leagueId: string) =>
    fetch(`${APP_ORIGIN}/api/fetchHeadlines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    }).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch headlines");
      return r.json();
    }),

  fetchSummaries: (leagueId: string, scoringType: string, draftData: unknown) =>
    fetch(`${APP_ORIGIN}/api/fetchSummaries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ REACT_APP_LEAGUE_ID: leagueId, scoring_type: scoringType, draftData }),
    }).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch summaries");
      return r.json();
    }),

  // bulk Sleeper-ID-keyed KTC value dump, for power rankings' dynasty
  // asset-value component - same endpoint the web Power Rankings page uses
  fetchAllPlayerValues: (): Promise<Record<string, any>> =>
    fetch(`${APP_ORIGIN}/api/fetchAllPlayerValues`).then((r) => r.json()),

  // real NFL scoring plays + turnovers for a matchup's starters, with each
  // play's fantasy point impact - same endpoint the web schedule page's
  // matchup feed uses
  fetchMatchupFeed: (
    week: number,
    season: string | number,
    players: unknown[],
    scoringSettings: Record<string, number>
  ) =>
    fetch(`${APP_ORIGIN}/api/fetchMatchupFeed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, season, players, scoringSettings }),
    }).then((r) => r.json()),
};

// Firestore collection names + shapes, mirrored from the web app.
export const firestoreCollections = {
  weeklyArticles: "Weekly Articles", // { league_id, date, welcome?, preview?, playoff_predictions? }
  homePoll: "Home Poll", // single doc with id === "homepoll", votes: PlayerVoteInfo[]
  matchupPolls: "Matchup Polls", // { league_id, matchups: [{ matchup_id, votes: VoteInfo[] }] }
  weeklyHeadlines: "Weekly Headlines", // { league_id, headlines: HeadlineItem[] }
};
