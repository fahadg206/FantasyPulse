import { MatchupMapData, ScheduleData } from "./getMatchupData";
import { displayName } from "./getTopPerformers";

export interface GeneratedHeadline {
  id: number;
  category: string;
  title: string;
  description: string;
}

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

// Several witty phrasing variants per situation, picked at random, so the
// generator reads with some real personality instead of one flat template
// repeated every week - built from real stats, but written with the same
// "creative, sports-anchor" energy the old LLM prompt was going for.
const NAIL_BITER_TITLES = (winner: string, loser: string) => [
  `${winner} Escapes By the Skin of Their Teeth`,
  `${winner} Survives a Full-On Heart Attack Special Against ${loser}`,
  `Nobody Move! ${winner} Barely Slips Past ${loser}`,
  `${winner} Wins the Staring Contest With ${loser}`,
  `${loser} Nearly Pulls Off the Upset — But Not Quite`,
];
const NAIL_BITER_DESC = (diff: number, loser: string) => [
  `It came down to the wire — just ${diff.toFixed(1)} points stood between glory and heartbreak.`,
  `A photo finish for the ages: only ${diff.toFixed(1)} points decided this one.`,
  `${loser} had this one slipping away by a razor-thin ${diff.toFixed(1)} points. So close.`,
  `Bench points could've flipped this one. Final margin: ${diff.toFixed(1)}.`,
];

const BLOWOUT_TITLES = (winner: string, loser: string) => [
  `${winner} Sends ${loser} Home Crying`,
  `${winner} Puts On an Absolute Clinic`,
  `${winner} Doesn't Just Win, They Humiliate ${loser}`,
  `Someone Call It — ${winner} Buries ${loser}`,
  `${loser} Never Stood a Chance Against ${winner}`,
];
const BLOWOUT_DESC = (winner: string, loser: string, diff: number) => [
  `A ${diff.toFixed(1)}-point beatdown that ${loser} would probably like to forget.`,
  `${winner} wins by a jaw-dropping ${diff.toFixed(1)} points. Ouch.`,
  `This one was over before it started — ${diff.toFixed(1)}-point margin of dominance.`,
  `${loser}'s bye week arrived a week early, apparently.`,
];

const STUD_TITLES = (name: string) => [
  `${name} Is Playing a Different Sport Right Now`,
  `${name} Just Broke the Scoreboard`,
  `${name} Goes Nuclear This Week`,
  `Somebody Get ${name} a Cape`,
  `${name} Casually Wins the Week By Themselves`,
];
const STUD_DESC = (team: string, name: string, points: number) => [
  `${team} didn't need luck this week — just ${name} going off for ${points.toFixed(1)}.`,
  `${points.toFixed(1)} points from ${name} alone. That's not a stat line, that's a highlight reel.`,
  `${name} single-handedly carried ${team} to a big week.`,
];

const STREAK_TITLES = (name: string) => [
  `${name} Can't Be Stopped, Won't Be Stopped`,
  `${name} Is Quietly Building a Dynasty`,
  `Is Anyone Going to Slow Down ${name}?`,
  `${name} Is the Team Nobody Wants to Play Right Now`,
];
const STREAK_DESC = (wins: string, losses: string, streak: string) => [
  `${wins}-${losses} and riding a ${streak} streak — the rest of the league should be worried.`,
  `A ${streak} streak and counting. At this point it's less "hot" and more "inevitable."`,
];

const CLOSE_MATCHUP_TITLES = (a: string, b: string) => [
  `${a} vs ${b}: Too Close to Call`,
  `Grab the Popcorn — ${a} and ${b} Are Neck and Neck`,
  `${a} vs ${b} Might Come Down to the Last Player on the Bench`,
];
const CLOSE_MATCHUP_DESC = (margin: number) => [
  `Projections have this one separated by less than ${Math.max(1, Math.round(margin))} points heading in.`,
  `This is as close to a coin flip as the projections get - could go either way.`,
];

// Takes matchup data the caller has already fetched (rather than fetching
// its own copy) so it can double as a same-tick fallback when the LLM-based
// headlines call fails or is slow, without a duplicate network round trip.
export function generateHeadlines(
  matchupMap: Map<string, MatchupMapData[]>,
  updatedScheduleData: ScheduleData,
  week: number,
  playersData: any
): GeneratedHeadline[] {
  const pairs = Array.from(matchupMap.values()).filter(
    (teams): teams is [MatchupMapData, MatchupMapData] => teams.length === 2 && !!teams[0] && !!teams[1]
  );

  const headlines: GeneratedHeadline[] = [];
  const hasScores = pairs.some(
    ([a, b]) => parseFloat(a.team_points || "0") > 0 || parseFloat(b.team_points || "0") > 0
  );

  if (hasScores) {
    let closest: { winner: MatchupMapData; loser: MatchupMapData; diff: number } | undefined;
    let blowout: { winner: MatchupMapData; loser: MatchupMapData; diff: number } | undefined;

    for (const [a, b] of pairs) {
      const pa = parseFloat(a.team_points || "0");
      const pb = parseFloat(b.team_points || "0");
      if (pa === 0 && pb === 0) continue;
      const diff = Math.abs(pa - pb);
      const winner = pa >= pb ? a : b;
      const loser = winner === a ? b : a;
      if (!closest || diff < closest.diff) closest = { winner, loser, diff };
      if (!blowout || diff > blowout.diff) blowout = { winner, loser, diff };
    }

    if (closest && closest.diff < 15) {
      headlines.push({
        id: 1,
        category: "Nail-Biter",
        title: pick(NAIL_BITER_TITLES(closest.winner.name, closest.loser.name)),
        description: pick(NAIL_BITER_DESC(closest.diff, closest.loser.name)),
      });
    }

    if (blowout && blowout.diff >= 20) {
      headlines.push({
        id: 2,
        category: "Blowout",
        title: pick(BLOWOUT_TITLES(blowout.winner.name, blowout.loser.name)),
        description: pick(BLOWOUT_DESC(blowout.winner.name, blowout.loser.name, blowout.diff)),
      });
    }

    let topPlayer: { name: string; points: number; team: string } | undefined;
    for (const userId in updatedScheduleData) {
      const user = updatedScheduleData[userId];
      for (const starter of user.starters_full_data || []) {
        if (!starter.id) continue;
        const points = parseFloat(starter.points || "0");
        if (!topPlayer || points > topPlayer.points) {
          topPlayer = { name: displayName(starter), points, team: user.name };
        }
      }
    }
    if (topPlayer && topPlayer.points > 0) {
      headlines.push({
        id: 3,
        category: "Stud of the Week",
        title: pick(STUD_TITLES(topPlayer.name)),
        description: pick(STUD_DESC(topPlayer.team, topPlayer.name, topPlayer.points)),
      });
    }
  } else {
    // Pregame - lean on projections instead of actual scores.
    let closestProjected: { a: MatchupMapData; b: MatchupMapData; diff: number } | undefined;
    for (const [a, b] of pairs) {
      const projA = projectedTotal(updatedScheduleData[a.user_id ?? ""], playersData, week);
      const projB = projectedTotal(updatedScheduleData[b.user_id ?? ""], playersData, week);
      const diff = Math.abs(projA - projB);
      if (!closestProjected || diff < closestProjected.diff) closestProjected = { a, b, diff };
    }
    if (closestProjected) {
      headlines.push({
        id: 1,
        category: "Matchup to Watch",
        title: pick(CLOSE_MATCHUP_TITLES(closestProjected.a.name, closestProjected.b.name)),
        description: pick(CLOSE_MATCHUP_DESC(closestProjected.diff)),
      });
    }
  }

  const teams = Object.values(updatedScheduleData);
  const onStreak = [...teams]
    .filter((t) => t.streak && /^\d+W$/.test(t.streak))
    .sort((a, b) => parseInt(b.streak!) - parseInt(a.streak!))[0];
  if (onStreak && parseInt(onStreak.streak!) >= 2) {
    headlines.push({
      id: 4,
      category: "On Fire",
      title: pick(STREAK_TITLES(onStreak.name)),
      description: pick(STREAK_DESC(onStreak.wins ?? "0", onStreak.losses ?? "0", onStreak.streak!)),
    });
  }

  return headlines.slice(0, 4);
}

function projectedTotal(user: ScheduleData[string] | undefined, playersData: any, week: number): number {
  if (!user?.starters) return 0;
  let total = 0;
  for (const playerId of user.starters) {
    const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
    if (proj !== undefined) total += parseFloat(proj);
  }
  return total;
}
