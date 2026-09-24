import { buildLeagueTransactions, TickerEvent, TradeEvent, TxAsset } from "./leagueTransactions";
import { ensureSystemPost } from "./posts";

// Boogie The Writer's breaking-news voice for the league's actual trade
// wire - written to read like a real NFL insider's timeline (Schefter,
// Rapoport, Woj, Shams), not a form-letter notification: several
// differently-worded templates per trade shape, picked at random so two
// trades posted back to back don't read identically. Shared by the Trades
// tab and the league dashboard, so every trade this season - including
// ones that already happened before anyone opens this app again - gets
// posted the moment anyone loads either screen, not just when someone
// specifically visits Trades. Waiver moves are deliberately not announced
// here - too much volume for the feed to stay readable; they still show
// up in each manager's own "Recently Acquired" on their profile.

export function tradeLabel(event: TradeEvent): string {
  if (event.kind === "trade2") {
    return `Trade: ${event.teamA.name} & ${event.teamB.name}`;
  }
  return `Trade: ${event.parts.map((p) => p.team.name).join(", ")}`;
}

function assetListText(assets: TxAsset[]): string {
  return assets.map((a) => a.label).join(", ");
}

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function tradeSystemText(event: TradeEvent): string {
  if (event.kind === "trade2") {
    const teamA = event.teamA.name;
    const teamB = event.teamB.name;
    const gives = assetListText(event.aGives);
    const gets = assetListText(event.aGets);
    return pick([
      `🚨 Trade: ${teamA} send ${gives} to ${teamB} in exchange for ${gets}. Deal is official, sources tell me.`,
      `BREAKING: ${teamA} and ${teamB} have a deal in place — ${gives} headed to ${teamB} for ${gets}. It's done.`,
      `Hearing ${teamA} has traded ${gives} to ${teamB}, getting back ${gets}. Trade has been processed.`,
      `Trade call just came in: ${teamB} lands ${gives} from ${teamA} in exchange for ${gets}. Official now.`,
      `I'm told ${teamA} is sending ${gives} to ${teamB} for ${gets} in return. Deal is on the books.`,
      `Sources say it's a done deal: ${teamA} gets ${gets}, ${teamB} gets ${gives}.`,
    ]);
  }

  const parts = event.parts.map((p) => `${p.team.name} lands ${assetListText(p.receives)}`).join(" | ");
  return pick([
    `🚨 Trade: ${parts}. Deal is official.`,
    `BREAKING: A ${event.parts.length}-team trade is now official — ${parts}.`,
    `Sources confirm this one is done: ${parts}.`,
    `Multi-team deal just cleared: ${parts}.`,
  ]);
}

/** Boogie's final-score call, in the same varied insider voice as trades - used by the matchup screen when a game goes final. */
export function finalScoreText(
  team1: string,
  pts1: number,
  team2: string,
  pts2: number
): string {
  const p1 = pts1.toFixed(2);
  const p2 = pts2.toFixed(2);
  if (pts1 === pts2) {
    return pick([
      `🏈 FINAL: ${team1} ${p1} - ${team2} ${p2}. Dead even - split the difference on that one.`,
      `That's a final: ${team1} and ${team2} lock up at ${p1} apiece.`,
      `🏈 FINAL: ${team1} ${p1}, ${team2} ${p2}. A tie - you don't see that every week.`,
    ]);
  }
  const winner = pts1 > pts2 ? team1 : team2;
  const loser = pts1 > pts2 ? team2 : team1;
  const winnerPts = pts1 > pts2 ? p1 : p2;
  const loserPts = pts1 > pts2 ? p2 : p1;
  return pick([
    `🏈 FINAL: ${team1} ${p1} - ${team2} ${p2}. ${winner} takes it.`,
    `That's a wrap - ${winner} outlasts ${loser}, ${winnerPts} to ${loserPts}.`,
    `Final from this one: ${winner} gets the win over ${loser}, ${winnerPts}-${loserPts}.`,
    `${winner} closes it out over ${loser}, ${winnerPts} to ${loserPts}. Final.`,
    `Scores are in: ${team1} ${p1}, ${team2} ${p2}. ${winner} moves to the win column.`,
  ]);
}

/**
 * Backfills a Boogie post for every trade this league has had this season -
 * safe to call from anywhere, as often as every screen load, since
 * ensureSystemPost no-ops once a post already exists. Returns EVERY
 * transaction event (trades AND adds/drops), not just the trades, so
 * callers that need the full picture (Boogie's analyst desk, picking out
 * a single headline waiver move) don't have to fetch transactions a
 * second time - the Trades tab, which only wants trades, filters the
 * kinds it cares about back out.
 */
export async function announceLeagueTransactions(leagueId: string): Promise<TickerEvent[]> {
  const events = await buildLeagueTransactions(leagueId);
  const tradeEvents = events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti");

  await Promise.all(
    tradeEvents.map((event) =>
      ensureSystemPost({
        id: `trade_${leagueId}_${event.id}`,
        text: tradeSystemText(event),
        leagueId,
        targetType: "trade",
        targetId: event.id,
        targetLabel: tradeLabel(event),
        createdAtMs: event.timestamp,
      }).catch((error) => console.error("Error posting trade to feed:", error))
    )
  );

  return events;
}
