import { sleeper } from "./api";

export interface BracketTeam {
  rosterId?: number;
  name: string;
  avatar?: string;
  points?: number;
  placeholderLabel?: string;
}

export interface BracketMatch {
  matchId: number;
  round: number;
  placement?: number;
  teams: [BracketTeam | null, BracketTeam | null];
  winnerRosterId?: number;
}

export interface Bracket {
  season: string;
  rounds: BracketMatch[][];
  championRosterId?: number;
}

function placeholderFrom(from: { w?: number; l?: number } | undefined): BracketTeam | null {
  if (!from) return null;
  if (from.w !== undefined) return { name: `Winner of Match ${from.w}`, placeholderLabel: "TBD" };
  if (from.l !== undefined) return { name: `Loser of Match ${from.l}`, placeholderLabel: "TBD" };
  return null;
}

// Builds a display-ready bracket from Sleeper's winners_bracket endpoint -
// resolves each slot to a real manager (name/avatar/points) where the
// matchup has been decided, or a "Winner/Loser of Match N" placeholder
// where it hasn't, and enriches with each match's actual score by cross
// -referencing the corresponding week's matchups.
export async function getPlayoffBracket(leagueId: string): Promise<Bracket | null> {
  const [leagueRes, usersRes, rostersRes, bracketRaw] = await Promise.all([
    sleeper.getLeague(leagueId),
    sleeper.getLeagueUsers(leagueId),
    sleeper.getLeagueRosters(leagueId),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/winners_bracket`)
      .then((r) => r.json())
      .catch(() => []),
  ]);

  if (!Array.isArray(bracketRaw) || bracketRaw.length === 0) return null;

  const rosterInfo: Record<number, { name: string; avatar?: string }> = {};
  for (const roster of rostersRes.data) {
    const owner = usersRes.data.find((u: any) => u.user_id === roster.owner_id);
    rosterInfo[roster.roster_id] = {
      name: owner?.display_name ?? "Unknown",
      avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
    };
  }

  const playoffWeekStart: number = leagueRes.data.settings?.playoff_week_start ?? 15;
  const maxRound = Math.max(...bracketRaw.map((g: any) => g.r));
  const pointsByWeekRoster: Record<number, Record<number, number>> = {};
  await Promise.all(
    Array.from({ length: maxRound }, (_, i) => playoffWeekStart + i).map(async (week) => {
      try {
        const { data } = await sleeper.getMatchups(leagueId, week);
        pointsByWeekRoster[week] = {};
        for (const entry of data) pointsByWeekRoster[week][entry.roster_id] = entry.points ?? 0;
      } catch {
        pointsByWeekRoster[week] = {};
      }
    })
  );

  const resolveTeam = (
    rosterId: number | undefined,
    from: { w?: number; l?: number } | undefined,
    week: number
  ): BracketTeam | null => {
    if (rosterId === undefined) return placeholderFrom(from);
    const info = rosterInfo[rosterId];
    return {
      rosterId,
      name: info?.name ?? "Unknown",
      avatar: info?.avatar,
      points: pointsByWeekRoster[week]?.[rosterId],
    };
  };

  const rounds: BracketMatch[][] = [];
  for (let r = 1; r <= maxRound; r++) {
    const week = playoffWeekStart + (r - 1);
    const matches = bracketRaw
      .filter((g: any) => g.r === r)
      .sort((a: any, b: any) => a.m - b.m)
      .map(
        (g: any): BracketMatch => ({
          matchId: g.m,
          round: g.r,
          placement: g.p,
          teams: [resolveTeam(g.t1, g.t1_from, week), resolveTeam(g.t2, g.t2_from, week)],
          winnerRosterId: g.w,
        })
      );
    rounds.push(matches);
  }

  const finalGame = bracketRaw.find((g: any) => g.p === 1);

  return {
    season: leagueRes.data.season,
    rounds,
    championRosterId: finalGame?.w,
  };
}
