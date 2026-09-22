import { buildLeagueTransactions, TradeEvent, AddDropEvent, TxAsset } from "./leagueTransactions";
import { ensureSystemPost } from "./posts";

// Boogie The Writer's breaking-news voice - the same beat-reporter tone as
// the Articles feature, here covering the league's actual transaction wire.
// Shared by the Trades tab and the league dashboard, so every trade and
// waiver move this season - including ones that already happened before
// anyone opens this app again - gets posted the moment anyone loads either
// screen, not just when someone specifically visits Trades.

export function tradeLabel(event: TradeEvent): string {
  if (event.kind === "trade2") {
    return `Trade: ${event.teamA.name} & ${event.teamB.name}`;
  }
  return `Trade: ${event.parts.map((p) => p.team.name).join(", ")}`;
}

function assetListText(assets: TxAsset[]): string {
  return assets.map((a) => a.label).join(", ");
}

function tradeSystemText(event: TradeEvent): string {
  if (event.kind === "trade2") {
    return `🚨 TRADE: ${event.teamA.name} sends ${assetListText(event.aGives)} to ${event.teamB.name} for ${assetListText(event.aGets)}. Deal is official.`;
  }
  return `🚨 TRADE: ${event.parts.map((p) => `${p.team.name} lands ${assetListText(p.receives)}`).join(" | ")}. Deal is official.`;
}

function addSystemText(event: AddDropEvent): string {
  const posTeam = event.asset.pos ? ` (${event.asset.pos}${event.asset.team ? ` - ${event.asset.team}` : ""})` : "";
  return `📈 ${event.team.name} adds ${event.asset.label}${posTeam} off waivers.`;
}

/**
 * Backfills a Boogie post for every trade and waiver add this league has
 * had this season - safe to call from anywhere, as often as every screen
 * load, since ensureSystemPost no-ops once a post already exists. Returns
 * the trade events so callers that also need to *display* them (the
 * Trades tab) don't have to fetch transactions a second time.
 */
export async function announceLeagueTransactions(leagueId: string): Promise<TradeEvent[]> {
  const events = await buildLeagueTransactions(leagueId);
  const tradeEvents = events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti");
  const addEvents = events.filter((e): e is AddDropEvent => e.kind === "add");

  await Promise.all([
    ...tradeEvents.map((event) =>
      ensureSystemPost({
        id: `trade_${leagueId}_${event.id}`,
        text: tradeSystemText(event),
        leagueId,
        targetType: "trade",
        targetId: event.id,
        targetLabel: tradeLabel(event),
        createdAtMs: event.timestamp,
      }).catch((error) => console.error("Error posting trade to feed:", error))
    ),
    ...addEvents.map((event) =>
      ensureSystemPost({
        id: `add_${leagueId}_${event.id}`,
        text: addSystemText(event),
        leagueId,
        targetType: "waiver",
        targetId: event.id,
        targetLabel: `${event.team.name} - Waiver Wire`,
        createdAtMs: event.timestamp,
      }).catch((error) => console.error("Error posting waiver add to feed:", error))
    ),
  ]);

  return tradeEvents;
}
