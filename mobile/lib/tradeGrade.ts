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
  /** a plain-language read of who benefited - "" when it's close enough to just call fair, "Slightly favors X" for a real but modest lean, "X won this trade" for a clear one, "X robbed Y" for the worst tier */
  summary: string;
}

// One tier list drives the verdict text, the letter grade, and the
// verbal summary together, so "B" always means "Slightly favors" and
// nothing can drift out of sync between them. Real trades most people
// agree to land in the top two or three tiers - these bars run looser
// than a school grading curve on purpose, a genuinely even-ish trade
// should read as fair, not just "not technically robbery."
const TIERS: {
  max: number;
  letter: string;
  text: string;
  color: string;
  summary: (winner: string, loser: string) => string;
}[] = [
  { max: 0.1, letter: "A", text: "Fair trade", color: "#22c55e", summary: () => "" },
  { max: 0.25, letter: "B", text: "Slightly lopsided", color: "#84cc16", summary: (w) => `Slightly favors ${w}` },
  { max: 0.45, letter: "C", text: "Unfair", color: "#eab308", summary: (w) => `${w} won this trade` },
  { max: 0.7, letter: "D", text: "Lopsided", color: "#f97316", summary: (w) => `${w} won this trade` },
  { max: Infinity, letter: "F", text: "Highway robbery", color: "#ef4444", summary: (w, l) => `${w} robbed ${l}` },
];

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
    return {
      sides,
      winner: null,
      marginRatio: 0,
      verdict: { text: "No valued players", color: "#6b7280" },
      letterGrade: "—",
      summary: "",
    };
  }

  const sorted = [...sides].sort((a, b) => b.value - a.value);
  const avgSideValue = totalValue / sides.length;
  const marginRatio = avgSideValue > 0 ? (sorted[0].value - sorted[1].value) / avgSideValue : 0;

  const tier = TIERS.find((t) => marginRatio <= t.max)!;
  const winner = tier.letter === "A" ? null : sorted[0].team;
  const loser = sorted[sorted.length - 1].team;

  return {
    sides,
    winner,
    marginRatio,
    verdict: { text: tier.text, color: tier.color },
    letterGrade: tier.letter,
    summary: winner ? tier.summary(winner.name, loser.name) : "",
  };
}
