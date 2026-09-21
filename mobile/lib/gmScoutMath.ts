// src/lib/gmScout.ts
//
// Pure helpers for the GM Scout panel (no network calls - those live in
// pages/api/fetchGmScout.js). Dynasty Daddy's GM Scout page pulls from
// their own database that's been tracking every manager across every
// league and season they've connected, going back years - this app has no
// such database. What's actually reused here is that Sleeper itself
// preserves real season-over-season history for one specific league lineage
// via `previous_league_id`, which a live chain-walk can recover without
// needing a database of our own: verified against a real league at build
// time, its chain went exactly 4 seasons deep (2023-2026), matching what a
// "based on N league-seasons" figure would honestly claim here. What isn't
// reproducible without Dynasty Daddy's own database is tracking the SAME
// manager across DIFFERENT, unrelated leagues over time - only their
// current-season league count is derivable live (via Sleeper's
// /v1/user/{id}/leagues endpoint), not a historical one.

export interface DraftPickTransfer {
  round: number;
  season: string;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

export interface PickFlow {
  gained: number;
  lost: number;
}

/** how many picks a roster gained vs. lost in one trade */
export function pickFlowFromTrade(
  draftPicks: DraftPickTransfer[] | undefined,
  rosterId: number
): PickFlow {
  let gained = 0;
  let lost = 0;
  for (const pick of draftPicks || []) {
    if (pick.owner_id === rosterId && pick.previous_owner_id !== rosterId) {
      gained++;
    }
    if (pick.previous_owner_id === rosterId && pick.owner_id !== rosterId) {
      lost++;
    }
  }
  return { gained, lost };
}

export type GmScoutBadge =
  | "Pick Collector"
  | "Wheeler And Dealer"
  | "Buy And Hold"
  | "Rookie GM";

export interface BadgeClassificationInput {
  totalTrades: number;
  netPickFlow: number;
  seasonsTracked: number;
}

// Simple, transparent rule-based tags rather than a black-box score -
// tuned to be easy to reason about, not to match Dynasty Daddy's own
// (unpublished) thresholds exactly.
export function classifyBadges(
  input: BadgeClassificationInput
): GmScoutBadge[] {
  const badges: GmScoutBadge[] = [];

  if (input.seasonsTracked <= 1) {
    badges.push("Rookie GM");
    return badges;
  }

  const tradesPerSeason = input.totalTrades / input.seasonsTracked;

  if (input.netPickFlow >= 4) badges.push("Pick Collector");
  if (tradesPerSeason >= 6) badges.push("Wheeler And Dealer");
  if (tradesPerSeason <= 1) badges.push("Buy And Hold");

  return badges;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
