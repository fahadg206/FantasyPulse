import { View, Text, Image, Pressable } from "react-native";
import { Starter } from "../lib/getMatchupData";
import { getTeamColor, getTeamLogo } from "../lib/nflTeams";
import { formatBoxScoreLine, RawPlayerStats } from "../lib/playerBoxScore";
import { formatGameKickoff } from "../lib/formatTime";
import type { LiveGameDetail } from "../lib/nflGameStatus";
import { usePlayerDetail } from "./PlayerDetailProvider";
import { displayName } from "../lib/getTopPerformers";

// The exact real player-by-player matchup UI from the current-week matchup
// screen (app/league/[leagueID]/matchup.tsx) - pulled out here so Rivalry
// and League History can show a past matchup the same way instead of their
// own, plainer rosters list. Live per-player detail (real-time score/box
// score line, in-progress field position) is optional - a matchup that's
// long over just renders without that sub-row, the same as a still-upcoming
// one does on the live screen.

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#eab308",
  DEF: "#94a3b8",
  K: "#a855f7",
  FLEX: "#f97316",
  SFLEX: "#f97316",
};

const SLOT_LABEL: Record<string, string> = {
  WRRB_FLEX: "FLEX",
  FLEX: "FLEX",
  REC_FLEX: "FLEX",
  SUPER_FLEX: "SFLEX",
  IDP_FLEX: "IDP",
};

function slotLabel(slot: string) {
  return SLOT_LABEL[slot] ?? slot;
}

export function SectionHeader({ title, week }: { title: string; week?: number }) {
  return (
    <View className="flex-row items-center justify-between px-4 mb-2">
      <Text className="font-bold text-[15px] text-black dark:text-white">{title}</Text>
      {week !== undefined && <Text className="text-[12px] text-gray-400">Week {week}</Text>}
    </View>
  );
}

interface PlayerDetailContent {
  isLive: boolean;
  resultLine: string;
  boxScoreLine: string | null;
  showFieldBar: boolean;
  yardLine: number;
}

function getPlayerDetailContent(
  player: Starter | undefined,
  liveGameDetailsByTeam: Record<string, LiveGameDetail>,
  weeklyPlayerStats: Record<string, RawPlayerStats>
): PlayerDetailContent | null {
  if (!player || !player.team) return null;
  const detail = liveGameDetailsByTeam[player.team];
  if (!detail) return null;

  const opp = detail.opponentAbbr ?? "";
  const vsAt = detail.isHome ? "vs" : "@";

  if (detail.state === "pre") {
    const resultLine = detail.kickoff ? `${formatGameKickoff(detail.kickoff)} ${vsAt} ${opp}` : `${vsAt} ${opp}`;
    return { isLive: false, resultLine, boxScoreLine: null, showFieldBar: false, yardLine: 0 };
  }

  const isLive = detail.state === "in";
  const resultLine = isLive
    ? `Q${detail.period} ${detail.displayClock} ${detail.teamScore}-${detail.opponentScore} ${vsAt} ${opp}`
    : `${detail.teamScore > detail.opponentScore ? "W" : detail.teamScore < detail.opponentScore ? "L" : "T"} ${detail.teamScore}-${detail.opponentScore} ${vsAt} ${opp}`;

  const stats = player.id ? weeklyPlayerStats[player.id] : undefined;
  const boxScoreLine = formatBoxScoreLine(player.pos, stats);
  const showFieldBar = isLive && detail.hasPossession && detail.yardLine !== undefined;

  return { isLive, resultLine, boxScoreLine, showFieldBar, yardLine: detail.yardLine ?? 0 };
}

function FieldPositionBar({ yardLine }: { yardLine: number }) {
  const pct = Math.min(100, Math.max(0, yardLine));
  return (
    <View className="w-full mt-1.5">
      <View className="h-[5px] rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <View style={{ width: `${pct}%` }} className="h-full bg-brand rounded-full" />
      </View>
      <Text className="text-[8px] font-bold tracking-wide text-gray-400 dark:text-gray-600 mt-0.5 text-right">
        END ZONE
      </Text>
    </View>
  );
}

function PlayerDetail({ content, align }: { content: PlayerDetailContent | null; align: "left" | "right" }) {
  if (!content) return <View className="flex-1" />;
  return (
    <View className={`flex-1 ${align === "right" ? "items-end" : "items-start"}`}>
      <View className={`flex-row items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {content.isLive && <View className="w-[5px] h-[5px] rounded-full bg-brand" />}
        <Text
          numberOfLines={1}
          style={{ color: content.isLive ? "#e2465a" : "#6b7280" }}
          className="text-[10px] font-semibold"
        >
          {content.resultLine}
        </Text>
      </View>
      {content.showFieldBar && <FieldPositionBar yardLine={content.yardLine} />}
      {content.boxScoreLine && (
        <Text
          numberOfLines={2}
          className={`text-[10px] text-gray-500 mt-0.5 ${align === "right" ? "text-right" : "text-left"}`}
        >
          {content.boxScoreLine}
        </Text>
      )}
    </View>
  );
}

function PlayerHalf({ player, align }: { player?: Starter; align: "left" | "right" }) {
  const playerDetail = usePlayerDetail();
  if (!player || Object.keys(player).length === 0) {
    return (
      <View className={`flex-1 flex-row items-center ${align === "right" ? "justify-end" : ""}`}>
        <Text className="text-[11px] text-gray-400 italic">Empty</Text>
      </View>
    );
  }
  const isDef = player.pos === "DEF";
  const logo = isDef ? null : getTeamLogo(player.team);
  const hasScored = !!player.points && player.points !== "0";

  const info = (
    <View className={align === "left" ? "items-start" : "items-end"}>
      <Text numberOfLines={1} className="text-[13px] font-bold text-black dark:text-white">
        {displayName(player)}
      </Text>
      <View className={`flex-row items-center gap-1 mt-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Text className="text-[10px] text-gray-500">{player.team}</Text>
        {logo && <Image source={{ uri: logo }} className="w-[12px] h-[12px]" resizeMode="contain" />}
      </View>
    </View>
  );

  const photo = (
    <Image
      source={{
        uri: isDef ? (getTeamLogo(player.team) ?? undefined) : `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`,
      }}
      className={isDef ? "w-[34px] h-[34px]" : "w-[38px] h-[38px] rounded-full"}
      resizeMode={isDef ? "contain" : "cover"}
      style={{ backgroundColor: isDef ? "transparent" : getTeamColor(player.team) + "22" }}
    />
  );

  const scoreBlock = (
    <View className="w-[46px]" style={{ alignItems: align === "left" ? "flex-end" : "flex-start" }}>
      <Text
        numberOfLines={1}
        style={{ fontVariant: ["tabular-nums"] }}
        className="text-[14px] font-bold text-black dark:text-white"
      >
        {hasScored ? player.points : "-"}
      </Text>
      {player.proj !== undefined && (
        <Text numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }} className="text-[10px] text-gray-500">
          {player.proj}
        </Text>
      )}
    </View>
  );

  const openDetail = () => playerDetail?.openPlayer({ playerId: player.id, name: displayName(player), position: player.pos ?? "", team: player.team });

  if (align === "left") {
    return (
      <View className="flex-1 flex-row items-center gap-2">
        <Pressable className="flex-row items-center gap-2 flex-1" onPress={openDetail}>
          {photo}
          {info}
        </Pressable>
        <View style={{ marginLeft: "auto" }}>{scoreBlock}</View>
      </View>
    );
  }
  return (
    <View className="flex-1 flex-row items-center justify-end gap-2">
      <View style={{ marginRight: "auto" }}>{scoreBlock}</View>
      <Pressable className="flex-row items-center justify-end gap-2 flex-1" onPress={openDetail}>
        {info}
        {photo}
      </Pressable>
    </View>
  );
}

function MatchupRow({
  left,
  right,
  slot,
  dimmed,
  liveGameDetailsByTeam,
  weeklyPlayerStats,
}: {
  left?: Starter;
  right?: Starter;
  slot?: string;
  dimmed?: boolean;
  liveGameDetailsByTeam: Record<string, LiveGameDetail>;
  weeklyPlayerStats: Record<string, RawPlayerStats>;
}) {
  const badgeLabel = slot ? slotLabel(slot) : (left?.pos ?? right?.pos ?? "");
  const badgeColor = POSITION_COLOR[badgeLabel] ?? POSITION_COLOR[left?.pos ?? right?.pos ?? ""] ?? "#9ca3af";

  const leftContent = getPlayerDetailContent(left, liveGameDetailsByTeam, weeklyPlayerStats);
  const rightContent = getPlayerDetailContent(right, liveGameDetailsByTeam, weeklyPlayerStats);
  const rowIsLive = !!leftContent?.isLive || !!rightContent?.isLive;

  return (
    <View
      className={
        rowIsLive
          ? `my-1 px-2 py-2.5 rounded-2xl bg-brand/15 border border-brand/30 ${dimmed ? "opacity-70" : ""}`
          : `py-2.5 border-b border-gray-100 dark:border-white/5 ${dimmed ? "opacity-70" : ""}`
      }
    >
      <View className="flex-row items-center">
        <PlayerHalf player={left} align="left" />
        {badgeLabel ? (
          <View style={{ backgroundColor: badgeColor }} className="rounded px-1.5 py-0.5 mx-2 min-w-[34px] items-center">
            <Text className="text-white text-[9px] font-bold">{badgeLabel}</Text>
          </View>
        ) : (
          <View className="mx-2 w-[34px]" />
        )}
        <PlayerHalf player={right} align="right" />
      </View>

      {(leftContent || rightContent) && (
        <View className="flex-row items-start mt-1.5">
          <PlayerDetail content={leftContent} align="left" />
          <View className="mx-2 w-[34px]" />
          <PlayerDetail content={rightContent} align="right" />
        </View>
      )}
    </View>
  );
}

export default function MatchupPlayerGrid({
  starters1,
  starters2,
  bench1 = [],
  bench2 = [],
  slots = [],
  week,
  liveGameDetailsByTeam = {},
  weeklyPlayerStats = {},
}: {
  starters1: Starter[];
  starters2: Starter[];
  bench1?: Starter[];
  bench2?: Starter[];
  /** real roster_positions slot labels for that season, in order - falls back to each row's own player.pos when not supplied (a historical matchup that only has real starters, no real slot template) */
  slots?: string[];
  week?: number;
  liveGameDetailsByTeam?: Record<string, LiveGameDetail>;
  weeklyPlayerStats?: Record<string, RawPlayerStats>;
}) {
  const rowCount = Math.max(slots.length, starters1.length, starters2.length);
  const benchRowCount = Math.max(bench1.length, bench2.length);

  return (
    <View className="bg-white dark:bg-black rounded-t-3xl pt-5 pb-2">
      <SectionHeader title="Starters" week={week} />
      <View className="px-3">
        {Array.from({ length: rowCount }, (_, i) => (
          <MatchupRow
            key={i}
            left={starters1[i]}
            right={starters2[i]}
            slot={slots[i]}
            liveGameDetailsByTeam={liveGameDetailsByTeam}
            weeklyPlayerStats={weeklyPlayerStats}
          />
        ))}
      </View>

      {benchRowCount > 0 && (
        <>
          <View className="mt-4">
            <SectionHeader title="Bench" />
          </View>
          <View className="px-3">
            {Array.from({ length: benchRowCount }, (_, i) => (
              <MatchupRow
                key={i}
                left={bench1[i]}
                right={bench2[i]}
                dimmed
                liveGameDetailsByTeam={liveGameDetailsByTeam}
                weeklyPlayerStats={weeklyPlayerStats}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}
