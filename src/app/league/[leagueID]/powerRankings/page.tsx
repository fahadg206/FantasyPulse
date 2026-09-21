"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import { useRouter } from "next/navigation";
import helmet from "../../../images/helmet2.png";
import {
  computePowerRankings,
  PowerRankingResult,
  PowerRankingTier,
} from "@/lib/powerRankings";
import {
  getLeagueValueSettings,
  LeagueValueSettings,
  RawPlayerValue,
} from "@/lib/playerValue";

interface TeamDisplay {
  userId: string;
  name: string;
  avatar: string | typeof helmet;
}

const TIER_STYLES: Record<
  PowerRankingTier,
  { badge: string; bar: string }
> = {
  Contender: {
    badge:
      "bg-green-500/15 text-green-500 border border-green-500/30",
    bar: "bg-green-500",
  },
  "Playoff Contender": {
    badge: "bg-blue-500/15 text-blue-500 border border-blue-500/30",
    bar: "bg-blue-500",
  },
  "Middle of the Pack": {
    badge:
      "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30",
    bar: "bg-yellow-500",
  },
  Rebuild: {
    badge: "bg-red-500/15 text-red-500 border border-red-500/30",
    bar: "bg-red-500",
  },
  "No Chance": {
    badge: "bg-red-500/15 text-red-500 border border-red-500/30",
    bar: "bg-red-500",
  },
};

const PowerRankingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(
    "Loading Power Rankings"
  );
  const [rankings, setRankings] = useState<PowerRankingResult[]>([]);
  const [teamsById, setTeamsById] = useState<{
    [userId: string]: TeamDisplay;
  }>({});
  const [leagueSettings, setLeagueSettings] =
    useState<LeagueValueSettings | null>(null);

  const router = useRouter();
  const REACT_APP_LEAGUE_ID = localStorage.getItem("selectedLeagueID");

  useEffect(() => {
    if (
      typeof localStorage !== "undefined" &&
      (localStorage.getItem("selectedLeagueID") === null ||
        localStorage.getItem("selectedLeagueID") === undefined)
    ) {
      router.push("/");
    }
  }, [router]);

  useEffect(() => {
    const messages = [
      "Loading Power Rankings",
      "Weighing Roster Strength",
      leagueSettings?.isDynasty
        ? "Pricing Out Dynasty Assets"
        : "Crunching This Season's Record",
    ];
    let messageIndex = 0;
    const interval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setLoadingMessage(messages[messageIndex]);
    }, 3500);
    return () => clearInterval(interval);
  }, [leagueSettings]);

  useEffect(() => {
    const fetchData = async () => {
      if (!REACT_APP_LEAGUE_ID) return;
      try {
        const [usersRes, rostersRes, nflStateRes, settings, playersData] =
          await Promise.all([
            axios.get<any[]>(
              `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/users`
            ),
            axios.get<any[]>(
              `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/rosters`
            ),
            axios.get<any>("https://api.sleeper.app/v1/state/nfl"),
            getLeagueValueSettings(REACT_APP_LEAGUE_ID),
            fetch("/api/fetchPlayers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId: REACT_APP_LEAGUE_ID }),
            }).then((r) => r.json()),
          ]);

        setLeagueSettings(settings);

        const teamsDisplay: { [userId: string]: TeamDisplay } = {};
        usersRes.data.forEach((user: any) => {
          teamsDisplay[user.user_id] = {
            userId: user.user_id,
            name: user.display_name,
            avatar: user.avatar
              ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}`
              : helmet,
          };
        });
        setTeamsById(teamsDisplay);

        // Dynasty asset value needs every rostered player's KTC value in
        // one shot; redraft leagues never use it, so skip the fetch.
        let playerValuesBySleeperId: Record<string, RawPlayerValue> = {};
        if (settings.isDynasty) {
          const valuesRes = await fetch("/api/fetchAllPlayerValues");
          playerValuesBySleeperId = await valuesRes.json();
        }

        const currentWeek: number = nflStateRes.data.week || 1;
        const upcomingWeeks = [
          currentWeek,
          currentWeek + 1,
          currentWeek + 2,
        ];

        const teamsInput = rostersRes.data
          .filter((roster: any) => teamsDisplay[roster.owner_id])
          .map((roster: any) => ({
            rosterId: Number(roster.roster_id),
            userId: roster.owner_id,
            wins: parseInt(roster.settings?.wins || "0"),
            losses: parseInt(roster.settings?.losses || "0"),
            rosterSleeperIds: roster.players || [],
            starterSleeperIds: roster.starters || [],
          }));

        const result = computePowerRankings({
          teams: teamsInput,
          leagueSettings: settings,
          upcomingWeeks,
          playerValuesBySleeperId,
          getWeeklyStarterProjection: (starterIds, week) =>
            starterIds.reduce((sum, playerId) => {
              const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
              return sum + (proj !== undefined ? parseFloat(proj) : 0);
            }, 0),
        });

        setRankings(result);
        setLoading(false);
      } catch (error) {
        console.error("Error computing power rankings:", error);
        setLoading(false);
      }
    };

    fetchData();
  }, [REACT_APP_LEAGUE_ID]);

  if (loading) {
    return (
      <div role="status" className=" h-[60vh] flex justify-center items-center">
        <svg
          aria-hidden="true"
          className="w-8 h-8 mr-2 text-black animate-spin dark:text-gray-600 fill-[#af1222]"
          viewBox="0 0 100 101"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
            fill="currentColor"
          />
          <path
            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
            fill="currentFill"
          />
        </svg>
        <span>{loadingMessage}</span>
      </div>
    );
  }

  return (
    <div className="md:w-[60vw] min-w-full min-h-screen bg-[#EDEDED] dark:bg-black p-4">
      <div className="bg-[#e0dfdf] dark:bg-[#1a1a1a] rounded-lg shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Power Rankings</h1>
          {leagueSettings && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#af1222]/10 text-[#af1222]">
              {leagueSettings.isDynasty ? "Dynasty" : "Redraft"}
              {leagueSettings.isSuperflex ? " · Superflex" : ""}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {leagueSettings?.isDynasty
            ? "Blends this season's roster strength and record with the long-term value of the whole roster - starters and bench."
            : "Based entirely on this season's roster strength and record - nothing carries over, so there's no long-term outlook to weigh."}
        </p>
        <div className="flex flex-col gap-2">
          {rankings.map((team) => {
            const display = teamsById[team.userId];
            const style = TIER_STYLES[team.tier];
            return (
              <div
                key={team.userId}
                className="flex items-center gap-3 p-3 rounded-lg bg-[#d1d1d1] dark:bg-[#2a2a2a]"
              >
                <span className="w-6 text-center font-bold text-sm">
                  {team.rank}
                </span>
                <Image
                  src={display?.avatar || helmet}
                  alt={display?.name || "team avatar"}
                  width={36}
                  height={36}
                  className="rounded-full bg-slate-300 object-cover object-top"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {display?.name || "Unknown Manager"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className={`h-full ${style.bar}`}
                        style={{ width: `${team.powerScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">
                      {team.powerScore}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${style.badge}`}
                >
                  {team.tier}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PowerRankingsPage;
