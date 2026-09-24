import type { Title } from "./profileActivity";

// Championships from before this platform existed, or that the real
// bracket crawl otherwise can't correctly credit, aren't derivable the way
// getAllTimeStats' real titles are - ProfileActivity's extraTitles prop
// accepts them directly, and this is that list. Keyed by real Sleeper user
// id (stable and works for every manager, not just ones with a Fantasy
// Pulse account - a Sleeper username/app username can both change, the
// id never does) rather than app username, so it also reaches
// /profile/manager/[sleeperUserId] for a manager with no account. Add an
// entry here whenever someone asks for a title credited that the real
// crawl can't find (or gets wrong) on its own.
const MANUAL_TITLES: Record<string, Title[]> = {
  "865355294702723072": [{ leagueName: "Champions League", season: "2022" }], // 123Cancun / Boogie
  "844022558880825344": [{ leagueName: "Champions League", season: "2021" }], // _FG
  "850329160579682304": [{ leagueName: "Champions League", season: "2023" }], // SleepyKey
};

export function getManualTitles(sleeperUserId: string): Title[] {
  return MANUAL_TITLES[sleeperUserId] ?? [];
}
