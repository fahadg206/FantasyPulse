import { sleeper, backend } from "./api";

export interface TxAsset {
  isPick?: boolean;
  id?: string;
  label: string;
  pos?: string;
  team?: string;
}

export interface TxTeam {
  userId?: string;
  name: string;
  avatar?: string;
}

export type AddDropEvent = { kind: "add" | "drop"; team: TxTeam; asset: TxAsset; timestamp: number };
export type TradeEvent = (
  | { kind: "trade2"; teamA: TxTeam; teamB: TxTeam; aGives: TxAsset[]; aGets: TxAsset[] }
  | { kind: "tradeMulti"; parts: { team: TxTeam; receives: TxAsset[] }[] }
) & { timestamp: number };
export type TickerEvent = AddDropEvent | TradeEvent;

function assetFromPlayer(playerId: string, playersData: any): TxAsset {
  const p = playersData?.[playerId];
  if (!p) return { id: playerId, label: "a player" };
  if (p.pos === "DEF") return { id: playerId, label: `${p.t ?? playerId} D/ST`, pos: "DEF", team: p.t ?? playerId };
  return { id: playerId, label: `${p.fn ?? ""} ${p.ln ?? ""}`.trim() || "a player", pos: p.pos, team: p.t };
}

// Shared by the Dashboard's scrolling tickers and the Trade Calculator's
// full trade history - fetches every completed transaction this season
// once and resolves roster ids to real manager names/avatars and player
// ids to real player info.
export async function buildLeagueTransactions(leagueId: string): Promise<TickerEvent[]> {
  const [{ data: nflState }, { data: users }, { data: rosters }, playersData] = await Promise.all([
    sleeper.getNflState(),
    sleeper.getLeagueUsers(leagueId),
    sleeper.getLeagueRosters(leagueId),
    backend.fetchPlayers(leagueId),
  ]);

  const rosterToTeam: Record<number, TxTeam> = {};
  for (const roster of rosters) {
    const owner = users.find((u: any) => u.user_id === roster.owner_id);
    rosterToTeam[roster.roster_id] = {
      userId: roster.owner_id,
      name: owner?.display_name ?? "A team",
      avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
    };
  }

  const week: number = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
  const weeks = Array.from({ length: Math.max(1, week) }, (_, i) => i + 1);
  const weekResults = await Promise.all(
    weeks.map((w) =>
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
        .then((r) => r.json())
        .catch(() => [])
    )
  );

  const transactions = weekResults
    .flat()
    .filter((t: any) => t?.status === "complete")
    .sort((a: any, b: any) => (b.status_updated ?? 0) - (a.status_updated ?? 0));

  const events: TickerEvent[] = [];
  for (const t of transactions) {
    const timestamp: number = t.status_updated ?? t.created ?? 0;
    if (t.type === "trade") {
      const receivedByRoster: Record<number, TxAsset[]> = {};
      for (const pid in t.adds || {}) {
        const rid = t.adds[pid];
        (receivedByRoster[rid] ??= []).push(assetFromPlayer(pid, playersData));
      }
      for (const pick of t.draft_picks || []) {
        (receivedByRoster[pick.owner_id] ??= []).push({
          isPick: true,
          label: `${pick.season} Rd ${pick.round} Pick`,
        });
      }
      const rosterIds = Object.keys(receivedByRoster).map(Number);
      const team = (rid: number): TxTeam => rosterToTeam[rid] ?? { name: "A team" };
      if (rosterIds.length === 2) {
        const [ridA, ridB] = rosterIds;
        events.push({
          kind: "trade2",
          teamA: team(ridA),
          teamB: team(ridB),
          aGives: receivedByRoster[ridB] ?? [],
          aGets: receivedByRoster[ridA] ?? [],
          timestamp,
        });
      } else if (rosterIds.length > 0) {
        events.push({
          kind: "tradeMulti",
          parts: rosterIds.map((rid) => ({ team: team(rid), receives: receivedByRoster[rid] })),
          timestamp,
        });
      }
    } else {
      for (const pid in t.adds || {}) {
        const rid = t.adds[pid];
        events.push({
          kind: "add",
          team: rosterToTeam[rid] ?? { name: "A team" },
          asset: assetFromPlayer(pid, playersData),
          timestamp,
        });
      }
      for (const pid in t.drops || {}) {
        const rid = t.drops[pid];
        events.push({
          kind: "drop",
          team: rosterToTeam[rid] ?? { name: "A team" },
          asset: assetFromPlayer(pid, playersData),
          timestamp,
        });
      }
    }
  }
  return events;
}

// The Trade Calculator's "have these two ever traded" question shouldn't be
// limited to the current season - this crawls the league's previous_league_id
// chain (same pattern as getRivalry.ts) and pulls every trade between the
// two given managers across every season they've both been in this league.
export async function buildAllSeasonsTradesBetween(leagueId: string, userIds: [string, string]): Promise<TradeEvent[]> {
  const playersData = await backend.fetchPlayers(leagueId);
  const events: TradeEvent[] = [];
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId && currentLeagueId !== "0") {
    const leagueIdForRequest: string = currentLeagueId;
    let leagueRes, usersRes, rostersRes;
    try {
      [leagueRes, usersRes, rostersRes] = await Promise.all([
        sleeper.getLeague(leagueIdForRequest),
        sleeper.getLeagueUsers(leagueIdForRequest),
        sleeper.getLeagueRosters(leagueIdForRequest),
      ]);
    } catch {
      break;
    }

    const rosterToTeam: Record<number, TxTeam> = {};
    for (const roster of rostersRes.data) {
      const owner = usersRes.data.find((u: any) => u.user_id === roster.owner_id);
      rosterToTeam[roster.roster_id] = {
        userId: roster.owner_id,
        name: owner?.display_name ?? "A team",
        avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
      };
    }

    const targetRosterIds = Object.entries(rosterToTeam)
      .filter(([, team]) => userIds.includes(team.userId ?? ""))
      .map(([rid]) => Number(rid));

    // Skip fetching this season's transactions entirely if these two
    // managers weren't both in the league that year.
    if (targetRosterIds.length === 2) {
      const week: number = Math.max(1, (leagueRes.data.settings?.playoff_week_start ?? 15) - 1);
      const weeks = Array.from({ length: week }, (_, i) => i + 1);
      const weekResults = await Promise.all(
        weeks.map((w) =>
          fetch(`https://api.sleeper.app/v1/league/${leagueIdForRequest}/transactions/${w}`)
            .then((r) => r.json())
            .catch(() => [])
        )
      );
      const transactions = weekResults.flat().filter((t: any) => t?.status === "complete" && t.type === "trade");

      for (const t of transactions) {
        const timestamp: number = t.status_updated ?? t.created ?? 0;
        const receivedByRoster: Record<number, TxAsset[]> = {};
        for (const pid in t.adds || {}) {
          const rid = t.adds[pid];
          (receivedByRoster[rid] ??= []).push(assetFromPlayer(pid, playersData));
        }
        for (const pick of t.draft_picks || []) {
          (receivedByRoster[pick.owner_id] ??= []).push({
            isPick: true,
            label: `${pick.season} Rd ${pick.round} Pick`,
          });
        }
        const involvedRosterIds = Object.keys(receivedByRoster).map(Number);
        const bothInvolved = targetRosterIds.every((rid) => involvedRosterIds.includes(rid));
        if (!bothInvolved) continue;

        const team = (rid: number): TxTeam => rosterToTeam[rid] ?? { name: "A team" };
        if (involvedRosterIds.length === 2) {
          const [ridA, ridB] = involvedRosterIds;
          events.push({
            kind: "trade2",
            teamA: team(ridA),
            teamB: team(ridB),
            aGives: receivedByRoster[ridB] ?? [],
            aGets: receivedByRoster[ridA] ?? [],
            timestamp,
          });
        } else {
          events.push({
            kind: "tradeMulti",
            parts: involvedRosterIds.map((rid) => ({ team: team(rid), receives: receivedByRoster[rid] })),
            timestamp,
          });
        }
      }
    }

    currentLeagueId = leagueRes.data.previous_league_id;
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return events;
}
