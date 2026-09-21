// src/lib/playerValue.ts
//
// Turns the raw KeepTradeCut market values pulled in by the webcrawler
// (Desktop/Webcrawler -> MongoDB `fantasypulse.playersValues`) into a value
// that reflects one specific league's format and scoring settings.
//
// Two things happen here:
//   1. Bucket selection (exact): KTC already publishes four separate markets
//      -> dynasty 1QB, dynasty superflex, redraft 1QB, redraft superflex.
//      We just pick the right one for the league instead of always using the
//      dynasty 1QB number like the app did before.
//   2. Heuristic nudges (approximate): KTC doesn't publish a market for every
//      possible scoring format, so TE premium / PPR level / passing-TD points
//      are applied as tunable percentage adjustments on top of the selected
//      bucket. These are reasonable approximations (similar to what tools
//      like FantasyCalc/DynastyProcess do), not a re-derivation from
//      projections - the multipliers below are labelled and easy to retune.

export interface LeagueValueSettings {
  isDynasty: boolean;
  isSuperflex: boolean;
  tePremium: number; // scoring_settings.bonus_rec_te, e.g. 0, 0.5, 1
  pprValue: number; // scoring_settings.rec, e.g. 0, 0.5, 1
  passingTdPoints: number; // scoring_settings.pass_td, usually 4 or 6
  startingQB: number;
  startingRB: number;
  startingWR: number;
  startingTE: number;
  startingFlex: number;
  rosterSize: number;
}

export interface RawPlayerValue {
  Value?: number; // dynasty, 1QB
  RdrftValue?: number; // redraft, 1QB
  SFValue?: number; // dynasty, superflex
  SFRdrftValue?: number; // redraft, superflex
  Position?: string;
  "Sleeper ID"?: string;
}

const SUPERFLEX_SLOT_NAMES = new Set([
  "SUPER_FLEX",
  "SUPERFLEX",
  "QB/RB/WR/TE",
]);
const FLEX_SLOT_NAMES = new Set([
  "FLEX",
  "WRRB_FLEX",
  "REC_FLEX",
  "SUPER_FLEX",
  "SUPERFLEX",
]);

// Sleeper's `league.settings.type`: 0 = redraft, 1 = keeper, 2 = dynasty.
// Keeper leagues behave closer to dynasty for trade-value purposes (rosters
// carry over), so we treat type 1 and 2 both as "dynasty" for this engine.
const DYNASTY_SETTINGS_TYPES = new Set([1, 2]);

export async function getLeagueValueSettings(
  leagueId: string
): Promise<LeagueValueSettings> {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch league ${leagueId}: ${res.status}`);
  }
  const league = await res.json();

  const rosterPositions: string[] = league?.roster_positions || [];
  const scoring = league?.scoring_settings || {};

  const qbSlots = rosterPositions.filter((p) => p === "QB").length;
  const superflexSlots = rosterPositions.filter((p) =>
    SUPERFLEX_SLOT_NAMES.has(p)
  ).length;

  return {
    isDynasty: DYNASTY_SETTINGS_TYPES.has(league?.settings?.type),
    isSuperflex: qbSlots + superflexSlots >= 2,
    tePremium: scoring.bonus_rec_te || 0,
    pprValue: scoring.rec ?? 1,
    passingTdPoints: scoring.pass_td ?? 4,
    startingQB: qbSlots,
    startingRB: rosterPositions.filter((p) => p === "RB").length,
    startingWR: rosterPositions.filter((p) => p === "WR").length,
    startingTE: rosterPositions.filter((p) => p === "TE").length,
    startingFlex: rosterPositions.filter((p) => FLEX_SLOT_NAMES.has(p))
      .length,
    rosterSize: rosterPositions.filter((p) => p !== "BN").length,
  };
}

// Picks the correct KTC market bucket for the league's format, falling back
// to the nearest available number if the crawler hasn't backfilled a bucket
// yet (e.g. SF fields on older rows).
export function getBaseValue(
  raw: RawPlayerValue,
  settings: Pick<LeagueValueSettings, "isDynasty" | "isSuperflex">
): number {
  const { isDynasty, isSuperflex } = settings;

  if (isDynasty) {
    return isSuperflex
      ? raw.SFValue || raw.Value || 0
      : raw.Value || raw.SFValue || 0;
  }
  return isSuperflex
    ? raw.SFRdrftValue || raw.RdrftValue || 0
    : raw.RdrftValue || raw.SFRdrftValue || 0;
}

export function computeAdjustedValue(
  raw: RawPlayerValue,
  settings: LeagueValueSettings
): number {
  let value = getBaseValue(raw, settings);
  if (!value) return 0;

  const position = raw.Position;

  // --- Tight End Premium ---
  // KTC's boards assume a standard (non-TEP) market. Scale TE value up with
  // the league's per-reception TE bonus: +28% at a full 1.0 TEP bonus,
  // linear, capped at 1.5 bonus points so extreme leagues don't blow up.
  if (position === "TE" && settings.tePremium > 0) {
    const tepFactor = Math.min(settings.tePremium, 1.5) * 0.28;
    value *= 1 + tepFactor;
  }

  // --- PPR level ---
  // KTC's boards are effectively full-PPR markets. If the league scores less
  // than a full point per reception, pass-catchers lose relative value; WR is
  // most exposed (volume-driven), RB least (goal-line/rushing value holds up).
  if (position === "WR" || position === "RB" || position === "TE") {
    const pprDelta = settings.pprValue - 1; // negative when below full PPR
    const positionSensitivity =
      position === "WR" ? 0.12 : position === "TE" ? 0.08 : 0.06;
    value *= 1 + pprDelta * positionSensitivity;
  }

  // --- Passing TD points ---
  // QBs are worth more in 6pt-passing-TD leagues than the 4pt market KTC prices.
  if (position === "QB") {
    const tdDelta = settings.passingTdPoints - 4;
    value *= 1 + tdDelta * 0.05; // +5% per extra point per passing TD
  }

  return Math.round(value);
}
