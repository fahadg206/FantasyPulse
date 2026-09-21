import { sleeper } from "./api";
import type { GeneratedArticle } from "./generatePreviewArticle";

// A stats-driven stand-in for the LLM-written "Power Rankings" article -
// ranks teams by real record/points instead of a network call, so it's
// immune to the backend's OpenAI timeout issues.
export async function generatePowerRankings(leagueId: string): Promise<GeneratedArticle> {
  const [{ data: users }, { data: rosters }] = await Promise.all([
    sleeper.getLeagueUsers(leagueId),
    sleeper.getLeagueRosters(leagueId),
  ]);

  const teams = rosters
    .map((r: any) => {
      const owner = users.find((u: any) => u.user_id === r.owner_id);
      const wins = r.settings?.wins ?? 0;
      const losses = r.settings?.losses ?? 0;
      const pointsFor = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
      return { name: owner?.display_name ?? "Unknown", wins, losses, pointsFor };
    })
    .sort((a: any, b: any) => b.wins - a.wins || b.pointsFor - a.pointsFor);

  const article: GeneratedArticle = {
    title: "Way Too Early Power Rankings",
    description: "Who's actually good, and who's just feasting on a soft schedule?",
  };

  teams.slice(0, 10).forEach((t: any, i: number) => {
    let line = `#${i + 1} ${t.name} (${t.wins}-${t.losses}, ${t.pointsFor.toFixed(1)} pts): `;
    if (i === 0) line += "The team to beat right now - nobody else is close.";
    else if (i === teams.length - 1) line += "Rough start, but there's a long way to go to turn it around.";
    else if (t.wins === 0) line += "Still searching for that first win.";
    else line += "Right in the mix - a couple of results either way could swing this a lot.";
    article[`paragraph${i + 1}`] = line;
  });

  return article;
}
