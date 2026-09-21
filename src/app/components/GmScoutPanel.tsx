"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import helmet from "../images/helmet2.png";
import { getLeagueValueSettings, LeagueValueSettings } from "@/lib/playerValue";
import { computePowerRankings, PowerRankingResult } from "@/lib/powerRankings";

interface GmScoutPanelProps {
  leagueId: string;
  managerUserId: string;
  managerName: string;
  managerAvatar: string;
}

interface GmScoutStats {
  seasonsTracked: number;
  seasons: { season: string; tradeCount: number; picksGained: number; picksLost: number }[];
  tradesThisSeason: number;
  tradesLastSeason: number | null;
  totalTrades: number;
  picksGained: number;
  picksLost: number;
  netPickFlow: number;
  leaguesCount: number | null;
  avgRosterAge: number | null;
  rookieOnRoster: { sleeperId: string; fn: string; ln: string; pos: string } | null;
  recentlyAcquired: {
    sleeperId: string;
    fn: string;
    ln: string;
    pos: string;
    date: string | null;
  } | null;
  badges: string[];
  record: { wins: number; losses: number; pointsFor: number };
}

const TIER_BADGE_STYLE: Record<string, string> = {
  Contender: "bg-green-500/15 text-green-500 border border-green-500/30",
  "Playoff Contender": "bg-blue-500/15 text-blue-500 border border-blue-500/30",
  "Middle of the Pack":
    "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30",
  Rebuild: "bg-red-500/15 text-red-500 border border-red-500/30",
  "No Chance": "bg-red-500/15 text-red-500 border border-red-500/30",
};

// A live-computed alternative to Dynasty Daddy's GM Scout page. Dynasty
// Daddy's version pulls from its own database that's tracked every manager
// across every league and season they've connected - this app has no such
// database. What's reused here instead: Sleeper itself preserves real
// season-over-season history for one league's lineage via
// `previous_league_id` (walked live in /api/fetchGmScout, verified against
// a real 4-season-deep league before shipping), so trade counts, pick flow,
// and "N league-seasons tracked" are real, not fabricated. What Dynasty
// Daddy has that this doesn't: the same manager's activity across entirely
// DIFFERENT leagues over time - only their current-season league count is
// derivable live, not a historical one.
const GmScoutPanel: React.FC<GmScoutPanelProps> = ({
  leagueId,
  managerUserId,
  managerName,
  managerAvatar,
}) => {
  const [stats, setStats] = useState<GmScoutStats | null>(null);
  const [tier, setTier] = useState<PowerRankingResult | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueValueSettings | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchScout = async () => {
      setLoading(true);
      setError(false);
      try {
        const [statsRes, settings, rostersRes, playersData] = await Promise.all([
          fetch("/api/fetchGmScout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leagueId, managerUserId }),
          }).then((r) => {
            if (!r.ok) throw new Error("gm scout request failed");
            return r.json();
          }),
          getLeagueValueSettings(leagueId),
          axios.get<any[]>(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch("/api/fetchPlayers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leagueId }),
          }).then((r) => r.json()),
        ]);

        let playerValuesBySleeperId: Record<string, any> = {};
        if (settings.isDynasty) {
          playerValuesBySleeperId = await fetch("/api/fetchAllPlayerValues").then(
            (r) => r.json()
          );
        }

        const nflStateRes = await axios.get<any>(
          "https://api.sleeper.app/v1/state/nfl"
        );
        const currentWeek: number = nflStateRes.data.week || 1;

        const teamsInput = rostersRes.data.map((roster: any) => ({
          rosterId: Number(roster.roster_id),
          userId: roster.owner_id,
          wins: parseInt(roster.settings?.wins || "0"),
          losses: parseInt(roster.settings?.losses || "0"),
          rosterSleeperIds: roster.players || [],
          starterSleeperIds: roster.starters || [],
        }));

        const rankings = computePowerRankings({
          teams: teamsInput,
          leagueSettings: settings,
          upcomingWeeks: [currentWeek, currentWeek + 1, currentWeek + 2],
          playerValuesBySleeperId,
          getWeeklyStarterProjection: (starterIds, week) =>
            starterIds.reduce((sum: number, playerId: string) => {
              const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
              return sum + (proj !== undefined ? parseFloat(proj) : 0);
            }, 0),
        });

        if (cancelled) return;
        setLeagueSettings(settings);
        setTier(
          rankings.find((r) => r.userId === managerUserId) || null
        );
        setStats(statsRes);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching GM scout data:", err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchScout();
    return () => {
      cancelled = true;
    };
  }, [leagueId, managerUserId]);

  if (loading) {
    return (
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
        Scouting {managerName}...
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
        Couldn&apos;t load GM Scout data right now.
      </div>
    );
  }

  return (
    <div className="w-[95vw] xl:w-[60vw] bg-[#e0dfdf] dark:bg-[#1a1a1a] rounded-lg shadow-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Image
            src={managerAvatar || helmet}
            alt={managerName}
            width={44}
            height={44}
            className="rounded-full bg-slate-300 object-cover object-top"
          />
          <div>
            <p className="font-bold">{managerName}</p>
            {tier && (
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  TIER_BADGE_STYLE[tier.tier]
                }`}
              >
                {tier.tier} · Rank #{tier.rank}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 dark:text-gray-400">Record</p>
          <p className="font-bold">
            {stats.record.wins}-{stats.record.losses}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
        <div className="bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
          <p className="text-gray-500 dark:text-gray-400">Points For</p>
          <p className="font-bold text-sm">{stats.record.pointsFor.toFixed(1)}</p>
        </div>
        <div className="bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
          <p className="text-gray-500 dark:text-gray-400">Trades This Season</p>
          <p className="font-bold text-sm">
            {stats.tradesThisSeason}
            {stats.tradesLastSeason !== null && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                {" "}
                (vs {stats.tradesLastSeason} last yr)
              </span>
            )}
          </p>
        </div>
        <div className="bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
          <p className="text-gray-500 dark:text-gray-400">Avg Roster Age</p>
          <p className="font-bold text-sm">
            {stats.avgRosterAge !== null ? stats.avgRosterAge : "N/A"}
          </p>
        </div>
        <div className="bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
          <p className="text-gray-500 dark:text-gray-400">Pick Flow</p>
          <p className="font-bold text-sm">
            <span className="text-green-500">+{stats.picksGained}</span>
            {" / "}
            <span className="text-red-500">-{stats.picksLost}</span>
          </p>
        </div>
      </div>

      {stats.badges.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {stats.badges.map((badge) => (
            <span
              key={badge}
              className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[#af1222]/10 text-[#af1222]"
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-xs">
        {stats.rookieOnRoster && (
          <div className="flex items-center gap-2 bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
            <img
              src={`https://sleepercdn.com/content/nfl/players/thumb/${stats.rookieOnRoster.sleeperId}.jpg`}
              alt={stats.rookieOnRoster.fn}
              className="w-8 h-8 rounded-full bg-slate-300 object-cover object-top"
            />
            <div>
              <p className="text-gray-500 dark:text-gray-400">
                Rookie On Roster
              </p>
              <p className="font-medium">
                {stats.rookieOnRoster.fn} {stats.rookieOnRoster.ln}{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  {stats.rookieOnRoster.pos}
                </span>
              </p>
            </div>
          </div>
        )}
        {stats.recentlyAcquired && (
          <div className="flex items-center gap-2 bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-lg p-2">
            <img
              src={`https://sleepercdn.com/content/nfl/players/thumb/${stats.recentlyAcquired.sleeperId}.jpg`}
              alt={stats.recentlyAcquired.fn}
              className="w-8 h-8 rounded-full bg-slate-300 object-cover object-top"
            />
            <div>
              <p className="text-gray-500 dark:text-gray-400">
                Recently Acquired
              </p>
              <p className="font-medium">
                {stats.recentlyAcquired.fn} {stats.recentlyAcquired.ln}{" "}
                {stats.recentlyAcquired.date && (
                  <span className="text-gray-500 dark:text-gray-400">
                    ·{" "}
                    {new Date(stats.recentlyAcquired.date).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">
        Based on {stats.seasonsTracked} league-season
        {stats.seasonsTracked === 1 ? "" : "s"} of real Sleeper trade history
        {stats.leaguesCount !== null &&
          ` · in ${stats.leaguesCount} Sleeper league${
            stats.leaguesCount === 1 ? "" : "s"
          } this season`}
        .
      </p>

      <Link
        href={`/league/${leagueId}/standings`}
        className="text-[11px] text-[#af1222] hover:underline"
      >
        View playoff odds on Standings →
      </Link>
      <br />
      <Link
        href={`/league/${leagueId}/tradeCalculator`}
        className="text-[11px] text-[#af1222] hover:underline"
      >
        Explore trades in the Trade Calculator →
      </Link>
    </div>
  );
};

export default GmScoutPanel;
