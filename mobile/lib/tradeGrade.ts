// Grades a real completed trade (from lib/leagueTransactions.ts) the same
// way Trade Calculator grades a hypothetical one - real trade value per
// side (lib/tradeValue.ts's dynasty-KTC/redraft-FantasyCalc lookup, the
// same real values the Calculator and Trade Finder already use, so a
// verdict here means the same thing it does there), a fairness read, and
// - when the gap is real, not just noise - a named winner.

import { TradeEvent, TxAsset, TxTeam } from "./leagueTransactions";
import type { TradeValueLookup } from "./tradeValue";

export interface TradeSideGrade {
  team: TxTeam;
  assets: TxAsset[];
  /** sum of real trade value across this side's real players - picks and unvalued players don't contribute (same "picks have no KTC market" rule the rest of the app already follows) */
  value: number;
}

export interface TradeGrade {
  sides: TradeSideGrade[];
  /** the side with the clearly better end of the deal - null when it's close enough to call even, or when nobody involved has a real valued player to grade off of */
  winner: TxTeam | null;
  /** 0 = dead even; how far the biggest side's value sits above the average side's value, as a fraction of that average */
  marginRatio: number;
  verdict: { text: string; color: string };
  /** A-F, same marginRatio bar as verdict just read as a single letter - "—" when there's nothing to grade off of */
  letterGrade: string;
}

function letterGradeFor(marginRatio: number, hasValue: boolean): string {
  if (!hasValue) return "—";
  if (marginRatio <= 0.08) return "A";
  if (marginRatio <= 0.2) return "B";
  if (marginRatio <= 0.3) return "C";
  if (marginRatio <= 0.5) return "D";
  return "F";
}

function sideAssetsFor(event: TradeEvent): { team: TxTeam; assets: TxAsset[] }[] {
  if (event.kind === "trade2") {
    return [
      { team: event.teamA, assets: event.aGets },
      { team: event.teamB, assets: event.aGives },
    ];
  }
  return event.parts.map((p) => ({ team: p.team, assets: p.receives }));
}

export function gradeTrade(event: TradeEvent, valueFor: TradeValueLookup): TradeGrade {
  const sides: TradeSideGrade[] = sideAssetsFor(event).map(({ team, assets }) => ({
    team,
    assets,
    value: assets.reduce((s, a) => s + (a.id && !a.isPick ? valueFor(a.id) : 0), 0),
  }));

  const totalValue = sides.reduce((s, side) => s + side.value, 0);
  if (sides.length < 2 || totalValue === 0) {
    return { sides, winner: null, marginRatio: 0, verdict: { text: "No valued players", color: "#6b7280" }, letterGrade: "—" };
  }

  const sorted = [...sides].sort((a, b) => b.value - a.value);
  const avgSideValue = totalValue / sides.length;
  const marginRatio = avgSideValue > 0 ? (sorted[0].value - sorted[1].value) / avgSideValue : 0;

  let verdict: { text: string; color: string };
  let winner: TxTeam | null = null;
  if (marginRatio <= 0.08) {
    verdict = { text: "Fair trade", color: "#22c55e" };
  } else if (marginRatio <= 0.2) {
    verdict = { text: "Slightly lopsided", color: "#eab308" };
    winner = sorted[0].team;
  } else if (marginRatio <= 0.4) {
    verdict = { text: "Unfair", color: "#f97316" };
    winner = sorted[0].team;
  } else {
    verdict = { text: "Lopsided", color: "#ef4444" };
    winner = sorted[0].team;
  }

  return { sides, winner, marginRatio, verdict, letterGrade: letterGradeFor(marginRatio, true) };
}
