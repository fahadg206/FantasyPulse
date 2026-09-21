import getMatchupData from "./getMatchupData";
import { displayName } from "./getTopPerformers";

export interface GeneratedArticle {
  title: string;
  description: string;
  [paragraph: string]: string;
}

function projTotal(user: any): number {
  return (user.starters_full_data || []).reduce((sum: number, p: any) => sum + parseFloat(p.proj || "0"), 0);
}

function topPlayer(user: any): { name: string; proj: number } | null {
  let best: { name: string; proj: number } | null = null;
  for (const s of user.starters_full_data || []) {
    if (!s.id) continue;
    const proj = parseFloat(s.proj || "0");
    if (!best || proj > best.proj) best = { name: displayName(s), proj };
  }
  return best;
}

// A stats-driven stand-in for the LLM-written weekly preview - built from
// real matchup data instead of a network call, so it's immune to the
// backend's OpenAI timeout issues. Same reasoning as generateHeadlines.ts.
export async function generatePreviewArticle(
  leagueId: string,
  week: number,
  playersData: any
): Promise<GeneratedArticle> {
  const { updatedScheduleData } = await getMatchupData(leagueId, week, playersData);

  const byMatchup = new Map<string, any[]>();
  for (const userId in updatedScheduleData) {
    const user = updatedScheduleData[userId];
    if (!user.matchup_id) continue;
    if (!byMatchup.has(user.matchup_id)) byMatchup.set(user.matchup_id, []);
    byMatchup.get(user.matchup_id)!.push(user);
  }
  const pairs = Array.from(byMatchup.values()).filter((p) => p.length === 2);

  const article: GeneratedArticle = {
    title: `Week ${week} Preview: Every Matchup Broken Down`,
    description: `A look at all ${pairs.length} matchups on tap this week, straight from the projections.`,
  };

  pairs.slice(0, 7).forEach(([a, b], i) => {
    const projA = projTotal(a);
    const projB = projTotal(b);
    const favorite = projA >= projB ? a : b;
    const underdog = favorite === a ? b : a;
    const margin = Math.abs(projA - projB);
    const star = topPlayer(favorite);

    let text = `${a.name} vs ${b.name}: `;
    if (margin < 8) {
      text += "This one's a toss-up - the projections have it separated by less than a touchdown. ";
    } else {
      text += `${favorite.name} comes in as the favorite over ${underdog.name} by about ${margin.toFixed(0)} points. `;
    }
    if (star) {
      text += `Keep an eye on ${star.name}, projected for around ${star.proj.toFixed(1)} points.`;
    }
    article[`paragraph${i + 1}`] = text;
  });

  return article;
}
