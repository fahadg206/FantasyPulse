import { useEffect, useState } from "react";
import { View, Text, Pressable, Image, Modal, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { MotiView } from "moti";
import type { FantasyProfileStats } from "../lib/fantasyProfile";
import {
  getTopRosteredPlayers,
  getRecentAcquisitions,
  getWeeklyMatchups,
  getAllTimeStats,
  TopRosteredPlayer,
  RecentAcquisition,
  WeeklyMatchup,
  CareerStats,
  Title,
  AllTimeNemesis,
} from "../lib/profileActivity";
import { formatTwitterTimestamp } from "../lib/formatTime";
import { getTeamLogo } from "../lib/nflTeams";
import { StartSitAccuracy } from "../lib/startSitAccuracy";
import Avatar from "./Avatar";
import { SkeletonBlock, SkeletonStatsBar, SkeletonRow, SkeletonMatchupCard, SkeletonListCard } from "./Skeleton";

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2.5">{children}</Text>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mb-4">{children}</View>;
}

// Everything that brings a Fantasy Profile to life beyond a bare record:
// this week's matchups, top rostered players, recent pickups, and the
// leagues themselves (tappable through to the real league). Shared by both
// the signed-in user's own profile and anyone else's public profile page,
// so the two never drift apart visually.
//
// `stats` arrives as null until the parent's own getFantasyProfileStats
// crawl resolves - this component mounts (and starts its OWN fetches)
// the moment sleeperUserId is known, not once stats is ready. That
// matters specifically for getAllTimeStats: it's the single heaviest
// crawl here (every season since 2017, every league), and it never
// actually needed stats.leagues in the first place - only
// getWeeklyMatchups/getTopRosteredPlayers/getRecentAcquisitions do. Under
// the old "wait for stats, then mount this component" structure, that
// crawl couldn't even start until the parent's fetch had fully finished,
// purely from component-mount ordering, not a real data dependency - now
// it runs the moment this component exists, genuinely in parallel with
// the parent's own fetch instead of stacked after it.
export default function ProfileActivity({
  sleeperUserId,
  season,
  stats,
  extraTitles = [],
}: {
  sleeperUserId: string;
  /** the season getAllTimeStats enumerates up through - independent of `stats` resolving, which is what lets that crawl start immediately */
  season: string;
  stats: FantasyProfileStats | null;
  /** championships from before this platform/account existed - not derivable from Sleeper, so they're passed in rather than crawled */
  extraTitles?: Title[];
}) {
  const router = useRouter();
  const [matchups, setMatchups] = useState<WeeklyMatchup[] | null>(null);
  const [topPlayers, setTopPlayers] = useState<TopRosteredPlayer[] | null>(null);
  const [acquisitions, setAcquisitions] = useState<RecentAcquisition[] | null>(null);
  const [career, setCareer] = useState<CareerStats | null>(null);
  const [startSit, setStartSit] = useState<StartSitAccuracy | null>(null);
  const [nemesis, setNemesis] = useState<AllTimeNemesis | null>(null);
  const [nemesisLogOpen, setNemesisLogOpen] = useState(false);

  // The heavy all-time crawl - starts as soon as sleeperUserId is known,
  // not gated behind stats. Career record and start/sit accuracy used to
  // be two fully separate all-time crawls, each re-enumerating every
  // season since 2017 and re-fetching every league's roster data
  // independently - merged into one shared crawl (getAllTimeStats) since
  // they're only ever needed together here.
  useEffect(() => {
    if (!sleeperUserId) return;
    let cancelled = false;
    getAllTimeStats(sleeperUserId, season)
      .then((r) => {
        if (cancelled) return;
        setCareer(r.career);
        setStartSit(r.startSit);
        setNemesis(r.nemesis);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [sleeperUserId, season]);

  // Everything that genuinely needs this season's resolved league list -
  // waits for stats, unlike the crawl above.
  useEffect(() => {
    if (!stats) return;
    let cancelled = false;
    const leagues = stats.leagues.map((l) => ({ leagueId: l.leagueId, leagueName: l.leagueName }));

    getWeeklyMatchups(sleeperUserId, leagues)
      .then((r) => !cancelled && setMatchups(r))
      .catch(console.error);
    getTopRosteredPlayers(sleeperUserId, leagues, 3)
      .then((r) => !cancelled && setTopPlayers(r))
      .catch(console.error);
    getRecentAcquisitions(sleeperUserId, leagues, 5)
      .then((r) => !cancelled && setAcquisitions(r))
      .catch(console.error);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeperUserId, stats?.season, stats?.leagues.map((l) => l.leagueId).join(",")]);

  const allTitles = [...(career?.titles ?? []), ...extraTitles];
  const totalTitles = (career?.championships ?? 0) + extraTitles.length;

  return (
    <View>
      {/* Career - leagues count front and center, plus all-time record.
          Both stats and career load independently now (in parallel, not
          one blocking the other) - shown as one silhouette until both are
          in, rather than a row half real numbers and half "-" placeholders. */}
      {!stats || !career ? (
        <SkeletonStatsBar />
      ) : (
        <View className="flex-row bg-[#141416] rounded-2xl border border-white/10 mb-4 overflow-hidden">
          <CareerStat value={stats.totals.leaguesCount} label="Leagues" />
          <CareerStat value={`${(career.winPct * 100).toFixed(0)}%`} label="Win Rate" />
          <CareerStat value={career.playoffAppearances} label="Playoff Appearances" />
          <CareerStat value={totalTitles > 0 ? `${totalTitles} 🏆` : "0"} label="Titles" last />
        </View>
      )}

      {/* Titles - which league and season each championship actually came
          from, not just the count already shown above. Covers leagues no
          longer active too, since getAllTimeStats crawls every season
          ever, not just this manager's current leagues - plus anything
          passed in via extraTitles (a championship from before this
          platform tracked anything). */}
      {allTitles.length > 0 && (
        <Card>
          <SectionLabel>CHAMPIONSHIPS</SectionLabel>
          <View className="gap-2">
            {allTitles.map((t, i) => (
              <View key={`${t.leagueName}_${t.season}_${i}`} className="flex-row items-center justify-between">
                <Text numberOfLines={1} className="text-white text-[13px] font-semibold flex-1 mr-2">
                  🏆 {t.leagueName}
                </Text>
                <Text className="text-gray-500 text-[11px]">{t.season}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {/* Start/Sit Accuracy - all-time lineup efficiency: points actually
          started vs. the best possible lineup from the full roster each
          week, across every league ever played. */}
      {startSit && startSit.weeksAnalyzed > 0 && (
        <View className="flex-row items-center justify-between bg-[#141416] rounded-2xl border border-white/10 px-4 py-3.5 mb-4">
          <View className="flex-1 mr-2">
            <Text className="text-white font-bold text-[14px]">Start/Sit Accuracy</Text>
            <Text className="text-gray-500 text-[11px] mt-0.5">
              All-time lineup efficiency · {startSit.weeksAnalyzed} weeks
            </Text>
          </View>
          <Text
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-white font-extrabold text-[22px]"
          >
            {(startSit.accuracy * 100).toFixed(1)}%
          </Text>
        </View>
      )}

      {/* All-Time Nemesis - the single opposing player who's put up the
          highest AVERAGE points against this manager whenever they've
          actually lined up against them, across every league/season ever
          tracked - not the most total damage (a name they've simply faced
          the most), the one who hurts worst per encounter. */}
      {nemesis && (
        <Pressable
          onPress={() => setNemesisLogOpen(true)}
          className="flex-row items-center bg-[#141416] rounded-2xl border border-[#ef444433] px-4 py-3.5 mb-4"
        >
          <View className="w-9 h-9 rounded-full bg-[#ef444422] items-center justify-center mr-3">
            <Feather name="alert-octagon" size={16} color="#ef4444" />
          </View>
          <Image
            source={{
              uri:
                nemesis.pos === "DEF"
                  ? getTeamLogo(nemesis.team) ?? undefined
                  : `https://sleepercdn.com/content/nfl/players/thumb/${nemesis.playerId}.jpg`,
            }}
            resizeMode={nemesis.pos === "DEF" ? "contain" : "cover"}
            className={nemesis.pos === "DEF" ? "w-[30px] h-[30px] mr-2.5" : "w-[30px] h-[30px] rounded-full bg-white/10 mr-2.5"}
          />
          <View className="flex-1 mr-2">
            <Text className="text-gray-500 text-[10px] font-bold tracking-widest">ALL-TIME NEMESIS</Text>
            <Text numberOfLines={1} className="text-white font-bold text-[14px] mt-0.5">
              {nemesis.name}
              {nemesis.pos ? <Text className="text-gray-500 font-semibold"> · {nemesis.pos}</Text> : null}
            </Text>
            <Text className="text-gray-500 text-[11px] mt-0.5">
              Faced {nemesis.games} {nemesis.games === 1 ? "time" : "times"} · tap for the games
            </Text>
          </View>
          <View className="items-end">
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#ef4444] font-extrabold text-[18px]">
              {nemesis.avgPoints.toFixed(1)}
            </Text>
            <Text className="text-gray-500 text-[10px]">pts/gm</Text>
          </View>
        </Pressable>
      )}

      <Modal
        visible={nemesisLogOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNemesisLogOpen(false)}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setNemesisLogOpen(false)}>
          <Pressable className="bg-[#141416] rounded-t-2xl max-h-[75%] overflow-hidden" onPress={() => {}}>
            <View className="items-center pt-3 pb-2">
              <View className="w-9 h-1 rounded-full bg-white/15" />
            </View>
            {nemesis && (
              <>
                <View className="flex-row items-center px-5 pb-3 border-b border-white/10">
                  <Image
                    source={{
                      uri:
                        nemesis.pos === "DEF"
                          ? getTeamLogo(nemesis.team) ?? undefined
                          : `https://sleepercdn.com/content/nfl/players/thumb/${nemesis.playerId}.jpg`,
                    }}
                    resizeMode={nemesis.pos === "DEF" ? "contain" : "cover"}
                    className={nemesis.pos === "DEF" ? "w-9 h-9 mr-3" : "w-9 h-9 rounded-full bg-white/10 mr-3"}
                  />
                  <View className="flex-1">
                    <Text className="text-white font-bold text-[14px]">{nemesis.name}</Text>
                    <Text className="text-gray-500 text-[11px]">
                      {nemesis.avgPoints.toFixed(1)} pts/gm across {nemesis.games} {nemesis.games === 1 ? "game" : "games"}
                    </Text>
                  </View>
                </View>
                <FlatList
                  data={nemesis.log}
                  keyExtractor={(g, i) => `${g.leagueId}_${g.season}_${g.week}_${i}`}
                  contentContainerClassName="px-5 py-2 pb-8"
                  renderItem={({ item: g }) => (
                    <View className="flex-row items-center justify-between py-2.5 border-b border-white/5">
                      <View className="flex-1 mr-2">
                        <Text className="text-white text-[13px] font-semibold">
                          {g.season} · Week {g.week}
                        </Text>
                        <Text numberOfLines={1} className="text-gray-500 text-[11px] mt-0.5">
                          {g.leagueName}
                        </Text>
                      </View>
                      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#ef4444] font-extrabold text-[15px]">
                        {g.points.toFixed(1)}
                      </Text>
                    </View>
                  )}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Leagues */}
      <SectionLabel>{season} SEASON</SectionLabel>
      {!stats ? (
        <>
          <SkeletonRow withCard />
          <SkeletonRow withCard />
          <SkeletonRow withCard />
        </>
      ) : (
        stats.leagues.map((l) => {
        // A win-loss record doesn't mean anything in a Chopped-format
        // league (no head-to-head) - cross-referenced against the same
        // detection getWeeklyMatchups already did, so it shows rank
        // instead wherever that league turned out to have no paired
        // opponent this week.
        const choppedMatch = matchups?.find((m) => m.leagueId === l.leagueId && m.isChoppedFormat);

        return (
          <Pressable
            key={l.leagueId}
            onPress={() => router.push(`/league/${l.leagueId}` as any)}
            className="flex-row items-center justify-between bg-[#141416] rounded-xl border border-white/10 px-4 py-3 mb-2"
          >
            <View className="flex-row items-center flex-1 mr-2">
              <Avatar url={l.avatar} name={l.leagueName} size={28} kind="league" />
              <View className="ml-2.5 flex-1">
                <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
                  {l.leagueName}
                </Text>
                <Text className="text-gray-500 text-[11px]">
                  Rank #{l.rank} of {l.totalTeams}
                </Text>
              </View>
            </View>
            <View className="items-end mr-1">
              {choppedMatch ? (
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
                  {choppedMatch.eliminatedWeek !== undefined
                    ? `Chopped · Wk ${choppedMatch.eliminatedWeek}`
                    : `Rank #${choppedMatch.rank ?? "-"}`}
                </Text>
              ) : (
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
                  {l.wins}-{l.losses}
                </Text>
              )}
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-500 text-[11px]">
                {l.pointsFor.toFixed(1)} pts
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color="#6b7280" />
          </Pressable>
        );
        })
      )}

      {/* This Week's Matchups */}
      {matchups === null ? (
        <View className="mb-1">
          <SkeletonBlock className="w-40 h-2.5 mb-2.5" />
          <SkeletonMatchupCard />
          <SkeletonMatchupCard />
        </View>
      ) : matchups.length > 0 ? (
        <View className="mb-1">
          <SectionLabel>WEEK {matchups[0].week} MATCHUPS</SectionLabel>
          {matchups.map((m) => (
            <Pressable
              key={m.leagueId}
              onPress={() =>
                m.hasOpponent
                  ? router.push({
                      pathname: "/league/[leagueID]/matchup",
                      params: { leagueID: m.leagueId, week: String(m.week), matchupID: m.matchupId },
                    } as any)
                  : router.push(`/league/${m.leagueId}` as any)
              }
              className="bg-[#141416] rounded-2xl border border-white/10 p-3.5 mb-2.5"
            >
              <View className="flex-row items-center justify-between mb-2">
                <Text numberOfLines={1} className="text-gray-500 text-[10px] font-bold flex-1 mr-2">
                  {m.leagueName.toUpperCase()}
                </Text>
                {m.isLive && <LiveBadge />}
              </View>
              {m.isChoppedFormat ? (
                // No head-to-head opponent in a Chopped-format league -
                // show this manager's standing instead: their live rank
                // among survivors, or which week they were chopped.
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2 flex-1 mr-2">
                    <Avatar url={m.myAvatar} name={m.myTeamName} size={26} />
                    <Text numberOfLines={1} className="text-white text-[13px] font-semibold flex-1">
                      {m.myTeamName}
                    </Text>
                  </View>
                  {m.eliminatedWeek !== undefined ? (
                    <Text className="text-[#ef4444] text-[13px] font-extrabold">
                      Chopped · Wk {m.eliminatedWeek}
                    </Text>
                  ) : (
                    <Text className="text-white text-[15px] font-extrabold">
                      Rank {m.rank ?? "-"}
                      {m.totalActiveTeams ? <Text className="text-gray-500 text-[12px] font-semibold"> of {m.totalActiveTeams}</Text> : null}
                    </Text>
                  )}
                </View>
              ) : (
                <>
                  <View className="flex-row items-center justify-between">
                    <MatchupSide
                      name={m.myTeamName}
                      score={m.myScore}
                      leading={m.status !== "pre" && m.myScore >= m.oppScore}
                      avatar={m.myAvatar}
                      showScore={m.status !== "pre"}
                    />
                    <Text className="text-gray-600 text-[11px] mx-2">vs</Text>
                    <MatchupSide
                      name={m.oppTeamName}
                      score={m.oppScore}
                      leading={m.status !== "pre" && m.oppScore > m.myScore}
                      avatar={m.oppAvatar}
                      align="right"
                      showScore={m.status !== "pre"}
                    />
                  </View>

                  {/* Pre-game only - same favorite+spread / O-U read
                      Schedule and the Dashboard scoreboard already show,
                      off the same real weekly projections. */}
                  {m.status === "pre" && (m.myProj > 0 || m.oppProj > 0) && (
                    <View className="flex-row items-center justify-center gap-1.5 mt-2.5 pt-2.5 border-t border-white/5">
                      <Feather name="bar-chart-2" size={10} color="#6b7280" />
                      <Text className="text-gray-400 text-[11px] font-bold">
                        {Math.round(m.myProj) === Math.round(m.oppProj)
                          ? "PICK'EM"
                          : m.myProj > m.oppProj
                            ? `${abbrevTeamName(m.myTeamName)} -${Math.round(m.myProj - m.oppProj)}`
                            : `${abbrevTeamName(m.oppTeamName)} -${Math.round(m.oppProj - m.myProj)}`}
                      </Text>
                      <Text className="text-gray-700 text-[11px]">·</Text>
                      <Text className="text-gray-500 text-[11px]">O/U {Math.round(m.myProj + m.oppProj)}</Text>
                    </View>
                  )}
                </>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Top Rostered Players */}
      {topPlayers === null ? (
        <SkeletonListCard rows={3} />
      ) : topPlayers.length > 0 ? (
        <Card>
          <SectionLabel>TOP ROSTERED PLAYERS</SectionLabel>
          <View className="gap-2.5">
            {topPlayers.map((p) => {
              const isDef = p.pos === "DEF";
              const logo = getTeamLogo(p.team);
              const photoUri = isDef ? logo ?? undefined : `https://sleepercdn.com/content/nfl/players/thumb/${p.playerId}.jpg`;
              return (
                <View key={p.playerId} className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2 flex-1 mr-2">
                    <Image
                      source={photoUri ? { uri: photoUri } : undefined}
                      resizeMode={isDef ? "contain" : "cover"}
                      className={isDef ? "w-[26px] h-[26px]" : "w-[26px] h-[26px] rounded-full bg-white/10"}
                    />
                    <Text
                      style={{ color: POSITION_COLOR[p.pos ?? ""] ?? "#9ca3af" }}
                      className="text-[10px] font-extrabold w-7"
                    >
                      {p.pos ?? "-"}
                    </Text>
                    {!isDef && logo && <Image source={{ uri: logo }} className="w-[16px] h-[16px]" resizeMode="contain" />}
                    <Text numberOfLines={1} className="text-white text-[13px] font-semibold flex-1">
                      {p.name}
                    </Text>
                  </View>
                  <Text className="text-gray-500 text-[11px]">
                    {p.leagueCount} of {stats?.totals.leaguesCount ?? "?"} leagues
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {/* Recent Acquisitions */}
      {acquisitions === null ? (
        <SkeletonListCard rows={3} />
      ) : acquisitions.length > 0 ? (
        <Card>
          <SectionLabel>RECENTLY ACQUIRED</SectionLabel>
          <View className="gap-2.5">
            {acquisitions.map((a, i) => (
              <Pressable
                key={`${a.playerId}_${a.leagueId}_${i}`}
                onPress={() => router.push(`/league/${a.leagueId}` as any)}
                className="flex-row items-center justify-between"
              >
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Feather name={a.via === "trade" ? "repeat" : "trending-up"} size={12} color="#af1222" />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-white text-[13px] font-semibold">
                      {a.name}
                      {a.pos ? <Text className="text-gray-500"> · {a.pos}</Text> : null}
                    </Text>
                    <Text numberOfLines={1} className="text-gray-500 text-[10px] mt-0.5">
                      {a.leagueName}
                    </Text>
                  </View>
                </View>
                <Text className="text-gray-500 text-[11px]">{formatTwitterTimestamp(a.timestamp)}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// Same pulsing-dot LIVE pill the dashboard scoreboard and schedule screen
// use, so a matchup that's actually underway reads the same way here.
function LiveDot() {
  return (
    <MotiView
      from={{ opacity: 1 }}
      animate={{ opacity: 0.2 }}
      transition={{ type: "timing", duration: 650, loop: true }}
      className="w-[5px] h-[5px] rounded-full bg-[#dc2626] mr-1.5"
    />
  );
}

function LiveBadge() {
  return (
    <View className="flex-row items-center bg-[#dc2626]/15 border border-[#dc2626]/40 rounded-full px-2 py-0.5">
      <LiveDot />
      <Text className="text-[9px] font-bold text-[#dc2626] tracking-wide">LIVE</Text>
    </View>
  );
}

function CareerStat({ value, label, last }: { value: string | number; label: string; last?: boolean }) {
  return (
    <View className={`flex-1 items-center py-3.5 ${!last ? "border-r border-white/10" : ""}`}>
      <Text className="text-white font-extrabold text-[16px]">{value}</Text>
      <Text className="text-gray-500 text-[10px] mt-0.5">{label}</Text>
    </View>
  );
}

function MatchupSide({
  name,
  score,
  leading,
  avatar,
  align = "left",
  showScore = true,
}: {
  name: string;
  score: number;
  leading: boolean;
  avatar?: string;
  align?: "left" | "right";
  /** false pre-game - a real score has nothing to show yet, so this renders "-" instead of a misleading "0.0" */
  showScore?: boolean;
}) {
  return (
    <View className={`flex-1 items-${align === "right" ? "end" : "start"}`}>
      <View className={`flex-row items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Avatar url={avatar} name={name} size={22} />
        <Text
          numberOfLines={1}
          className={`text-[12px] max-w-[90px] ${leading ? "text-white font-bold" : "text-gray-500 font-semibold"}`}
        >
          {name}
        </Text>
      </View>
      {showScore ? (
        <Text
          style={{ fontVariant: ["tabular-nums"] }}
          className={`text-[17px] mt-0.5 ${leading ? "text-white font-extrabold" : "text-gray-500 font-bold"}`}
        >
          {score.toFixed(1)}
        </Text>
      ) : (
        <Text className="text-gray-600 text-[13px] mt-0.5">--</Text>
      )}
    </View>
  );
}

function abbrevTeamName(name: string) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}
