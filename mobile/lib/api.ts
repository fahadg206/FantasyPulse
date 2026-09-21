import axios from "axios";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

export const sleeper = {
  getUser: (username: string) => axios.get(`${SLEEPER_BASE}/user/${username}`),
  getUserLeagues: (userId: string, season: string) =>
    axios.get(`${SLEEPER_BASE}/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId: string) => axios.get(`${SLEEPER_BASE}/league/${leagueId}`),
  getLeagueUsers: (leagueId: string) => axios.get(`${SLEEPER_BASE}/league/${leagueId}/users`),
  getLeagueRosters: (leagueId: string) => axios.get(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
  getMatchups: (leagueId: string, week: number) =>
    axios.get(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`),
  getNflState: () => axios.get(`${SLEEPER_BASE}/state/nfl`),
};

// The Next.js API routes (src/pages/api/*) stay deployed on the existing web
// app; the mobile app calls them the same way the web app's own client
// components do. NOT localhost — see articles/page.tsx's fixed bug.
export const APP_ORIGIN = "https://www.fantasypulseff.com";

export const backend = {
  fetchPlayers: (leagueId: string) =>
    fetch(`${APP_ORIGIN}/api/fetchPlayers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    }).then((r) => r.json()),

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

  fetchPlayerValue: (sleeperId: string, scoringType: string): Promise<{ value: number }> =>
    fetch(`${APP_ORIGIN}/api/fetchPlayerValues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sleeperId, scoringType }),
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
};

// Firestore collection names + shapes, mirrored from the web app.
export const firestoreCollections = {
  weeklyArticles: "Weekly Articles", // { league_id, date, welcome?, preview?, playoff_predictions? }
  homePoll: "Home Poll", // single doc with id === "homepoll", votes: PlayerVoteInfo[]
  matchupPolls: "Matchup Polls", // { league_id, matchups: [{ matchup_id, votes: VoteInfo[] }] }
  weeklyHeadlines: "Weekly Headlines", // { league_id, headlines: HeadlineItem[] }
};
