// Promotion/relegation-style standings zones for specific leagues that
// actually run that format - not derivable from Sleeper (it has no concept
// of this), so this is a manually-maintained mapping by league id, the
// same pattern as manualTitles.ts for pre-platform championships. Add an
// entry here whenever a league wants its own zone marked.

export type ZoneColor = "red" | "green";

export interface StandingsZone {
  label: string;
  color: ZoneColor;
  /** inclusive standings position range, 1-indexed. "last" resolves to the league's actual team count at render time, not a hardcoded number - so it stays correct however many teams that league has. */
  from: number | "last";
  to: number | "last";
}

const LEAGUE_ZONES: Record<string, StandingsZone[]> = {
  // Champions League
  "1389752489334571008": [{ label: "Relegation Zone", color: "red", from: 9, to: 12 }],
  // Redemption League
  "1389327121725292544": [
    { label: "Promotion Zone", color: "green", from: 1, to: 2 },
    { label: "Relegation Zone", color: "red", from: 9, to: 12 },
  ],
  // The Trenches
  "1389386847397900289": [
    { label: "Promotion Zone", color: "green", from: 1, to: 2 },
    { label: "Relegation Zone", color: "red", from: 9, to: 12 },
  ],
  // Hell League
  "1396298716083675136": [{ label: "Banished If Season Ended Today", color: "red", from: "last", to: "last" }],
};

function resolvePosition(pos: number | "last", totalTeams: number): number {
  return pos === "last" ? totalTeams : pos;
}

/** the zone (if any) this standings rank falls into for this league */
export function getZoneForRank(leagueId: string | undefined, rank: number, totalTeams: number): StandingsZone | undefined {
  if (!leagueId) return undefined;
  const zones = LEAGUE_ZONES[leagueId];
  if (!zones) return undefined;
  return zones.find((z) => {
    const from = resolvePosition(z.from, totalTeams);
    const to = resolvePosition(z.to, totalTeams);
    return rank >= from && rank <= to;
  });
}

/** true when `rank` is the first position of its zone - where the divider/label should render */
export function isZoneStart(leagueId: string | undefined, rank: number, totalTeams: number): boolean {
  const zone = getZoneForRank(leagueId, rank, totalTeams);
  if (!zone) return false;
  return rank === resolvePosition(zone.from, totalTeams);
}
