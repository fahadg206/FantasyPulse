// src/lib/bigPlayPoints.ts
//
// Turns a normalized play (see fetchMatchupFeed.js) into a fantasy point
// delta for whichever rostered player it belongs to, using the league's
// own scoring settings (Sleeper's raw scoring_settings object, e.g.
// rush_yd, rush_td, rec, rec_yd, pass_yd, pass_int). Positive for a player
// gaining points (a run, a catch, a touchdown), negative for a player
// losing them (an interception thrown, a fumble lost).
//
// Each gain function takes `isTouchdown` so the same formula covers both
// an ordinary gain and a scoring one (yardage points always apply; the
// touchdown bonus only on top of them) - fetchMatchupFeed.js decides
// whether a given play clears the "worth showing" bar itself, not this
// module.
//
// Coverage is intentionally scoped to what can be reliably parsed from
// ESPN's play text: rushes, receptions, field goals, interceptions thrown,
// and lost fumbles. Two-point conversions and safeties aren't handled (too
// rare in this feed to be worth the parsing risk) and simply return 0.

export type ScoringSettings = { [stat: string]: number };

function fieldGoalPoints(yardage: number, scoring: ScoringSettings): number {
  if (yardage >= 50) return scoring.fg_50p || 0;
  if (yardage >= 40) return scoring.fg_40_49 || 0;
  if (yardage >= 30) return scoring.fg_30_39 || 0;
  if (yardage >= 20) return scoring.fg_20_29 || 0;
  return scoring.fg_0_19 || 0;
}

export function computeRushPoints(
  yardage: number,
  isTouchdown: boolean,
  scoring: ScoringSettings
): number {
  return yardage * (scoring.rush_yd || 0) + (isTouchdown ? scoring.rush_td || 0 : 0);
}

export function computeReceptionPoints(
  yardage: number,
  isTouchdown: boolean,
  scoring: ScoringSettings
): number {
  return (
    yardage * (scoring.rec_yd || 0) +
    (scoring.rec || 0) +
    (isTouchdown ? scoring.rec_td || 0 : 0)
  );
}

export function computePassPoints(
  yardage: number,
  isTouchdown: boolean,
  scoring: ScoringSettings
): number {
  return yardage * (scoring.pass_yd || 0) + (isTouchdown ? scoring.pass_td || 0 : 0);
}

export function computeFieldGoalPoints(
  yardage: number,
  scoring: ScoringSettings
): number {
  return fieldGoalPoints(yardage, scoring);
}

export function computeInterceptionThrownPoints(
  scoring: ScoringSettings
): number {
  return scoring.pass_int || 0;
}

export function computeFumbleLostPoints(scoring: ScoringSettings): number {
  return scoring.fum_lost || 0;
}

/** rounds to the nearest tenth for display, matching how fantasy point totals are usually shown */
export function roundPoints(points: number): number {
  return Math.round(points * 10) / 10;
}
