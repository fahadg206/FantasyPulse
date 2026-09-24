// Team primary colors, used for player-card accents (Draft, Trade Calculator).
export const TEAM_COLORS: Record<string, string> = {
  BAL: "#241773", ATL: "#A71930", DEN: "#FB4F14", HOU: "#03202F",
  NO: "#D3BC8D", CLE: "#311D00", CIN: "#FB4E14", WAS: "#5A1414",
  LV: "#A6ACAF", PIT: "#FFC20E", DAL: "#003594", SEA: "#69BE28",
  SF: "#AA0000", ARI: "#972240", LAR: "#003594", TB: "#D50A0A",
  CAR: "#0085CA", GB: "#FFB612", DET: "#0076B6", MIN: "#4F2683",
  CHI: "#0B162A", BUF: "#00338D", NE: "#002244", MIA: "#008E97",
  IND: "#002C5F", JAC: "#006778", TEN: "#4B92DB", NYJ: "#125740",
  NYG: "#0B2265", PHI: "#004C54", KC: "#E31837", LAC: "#0080C6",
  FA: "#4b5563",
};

export function getTeamColor(team?: string): string {
  return (team && TEAM_COLORS[team.toUpperCase()]) || "#4b5563";
}

export function getTeamLogo(team?: string): string | null {
  if (!team || team === "FA") return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
}

// A position's own accent color - the same "at a glance" color-coding
// real fantasy sites use (Sleeper's own QB/RB/WR/TE labels are colored
// this same way). Shared by AssetChip's position tag and the player
// detail card's whole accent language, instead of each keeping its own copy.
export const POSITION_COLORS: Record<string, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

export function getPositionColor(pos?: string): string {
  return (pos && POSITION_COLORS[pos.toUpperCase()]) || "#9ca3af";
}
