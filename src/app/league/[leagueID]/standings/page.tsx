"use client";
import React, { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { FiAward } from "react-icons/fi";
import axios from "axios";
import helmet from "../../../images/helmet2.png";
import getMatchupMap from "../../../libs/getMatchupData";
import {
  simulatePlayoffOdds,
  SimMatchup,
  SimDivision,
} from "@/lib/playoffSimulator";

interface ManagerInfo {
  [userId: string]: {
    avatar: string;
    name: string;
    roster_id?: string;
    user_id?: string;
    starters?: string[];
    team_points_for_dec?: string;
    team_points_against_dec?: string;
    team_points_for?: string;
    team_points_against?: string;
    wins?: string;
    losses?: string;
    streak?: string;
    playoffOdds?: number;
    matchups?: {
      [week: number]: {
        opponentId?: string;
        points?: number;
      };
    };
  };
}

interface TeamData {
  avatar: string;
  name: string;
  roster_id?: string;
  user_id?: string;
  starters?: string[];
  team_points_for_dec?: string;
  team_points_against_dec?: string;
  team_points_for?: string;
  team_points_against?: string;
  wins?: string;
  losses?: string;
  playoffOdds?: number;
}

type SortedTeamData = [string, TeamData][];

const Page = () => {
  const [managerInfo, setManagerInfo] = useState<ManagerInfo>({});
  const [sortedTeamDataFinal, setSortedTeamDataFinal] =
    useState<SortedTeamData>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading Standings");
  const selectedLeagueID = localStorage.getItem("selectedLeagueID");
  const router = useRouter();
  const [playersData, setPlayersData] = useState<any>({});

  const REACT_APP_LEAGUE_ID =
    localStorage.getItem("selectedLeagueID") || "1003413138751987712";

  useEffect(() => {
    const messages = [
      "Loading Standings",
      "Importing League Data",
      "Calculating Projections",
    ];
    let messageIndex = 0;

    const interval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setLoadingMessage(messages[messageIndex]);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      typeof localStorage !== "undefined" &&
      (localStorage.getItem("selectedLeagueID") === null ||
        localStorage.getItem("selectedLeagueID") === undefined)
    ) {
      router.push("/");
    }
  }, [router]);

  const getUsers = async () => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${selectedLeagueID}/users`
      );
      return response.data;
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get users");
    }
  };

  const getRoster = async () => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${selectedLeagueID}/rosters`
      );
      return response.data;
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get rosters");
    }
  };

  const getLeagueSettings = async () => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${selectedLeagueID}`
      );
      return response.data;
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get league settings");
    }
  };

  const fetchMatchupData = async (week: number) => {
    try {
      return await getMatchupMap(REACT_APP_LEAGUE_ID, week);
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get matchups");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const playersResponse = await fetch("/api/fetchPlayers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leagueId: REACT_APP_LEAGUE_ID }),
        });
        const p_data = await playersResponse.json();
        console.log("Projections: ,", p_data["4984"]);
        setPlayersData(p_data);

        const usersData = await getUsers();
        const rostersData = await getRoster();
        const leagueSettings = await getLeagueSettings();
        const playoffStartWeek = leagueSettings.settings.playoff_week_start;

        // Which regular-season weeks are still ahead of us - re-simulating
        // weeks that have already been played would double count them on
        // top of the real wins already reflected in roster.settings.wins.
        const nflStateResponse = await axios.get<any>(
          "https://api.sleeper.app/v1/state/nfl"
        );
        const currentNflWeek: number = nflStateResponse.data.week || 1;

        const usersWithRoster = usersData.filter((user) =>
          rostersData.some((roster) => roster.owner_id === user.user_id)
        );

        const managerInfo: ManagerInfo = {};

        for (const user of usersWithRoster) {
          managerInfo[user.user_id] = {
            avatar: user.avatar
              ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}`
              : helmet,
            name: user.display_name,
            user_id: user.user_id,
            matchups: {}, // Initialize the matchups object
          };
        }

        for (const roster of rostersData) {
          if (managerInfo[roster.owner_id]) {
            managerInfo[roster.owner_id].roster_id = roster.roster_id;
            managerInfo[roster.owner_id].starters = roster.starters;
            managerInfo[roster.owner_id].team_points_for_dec =
              roster.settings.fpts_decimal;
            managerInfo[roster.owner_id].team_points_for = roster.settings.fpts;
            managerInfo[roster.owner_id].team_points_against_dec =
              roster.settings.fpts_against_decimal;
            managerInfo[roster.owner_id].team_points_against =
              roster.settings.fpts_against || "0";
            managerInfo[roster.owner_id].wins = roster.settings.wins;
            managerInfo[roster.owner_id].losses = roster.settings.losses;

            if (roster.metadata && roster.metadata.streak) {
              managerInfo[roster.owner_id].streak = roster.metadata.streak;
            }
          }
        }

        // Get matchups data for each week until the playoffs start
        const matchupData = {};
        for (let week = 1; week < playoffStartWeek; week++) {
          const data = await fetchMatchupData(week);
          matchupData[week] = data.updatedScheduleData;
        }

        console.log("Manager Info after fetching matchups:", managerInfo);

        const teamArray = Object.entries(managerInfo);
        const sortedTeamData = teamArray
          .sort((a, b) => {
            const bPoints =
              (parseFloat(b[1].team_points_for || "0") || 0) +
              (parseFloat(b[1].team_points_for_dec || "0") || 0) / 100;
            const aPoints =
              (parseFloat(a[1].team_points_for || "0") || 0) +
              (parseFloat(a[1].team_points_for_dec || "0") || 0) / 100;
            return bPoints - aPoints;
          })
          .sort((a, b) => {
            const winsA = parseInt(a[1].wins || "0");
            const winsB = parseInt(b[1].wins || "0");
            return winsB - winsA;
          });

        console.log("Sorted Team Data before simulation:", sortedTeamData);

        const updatedManagerInfo = await calculatePlayoffOdds(
          managerInfo,
          rostersData,
          leagueSettings,
          playoffStartWeek,
          currentNflWeek,
          p_data,
          matchupData
        );

        console.log("Sorted Team Data after simulation:", updatedManagerInfo);

        // Check if all teams have a 0-0 record
        const allZeroRecord = sortedTeamData.every(
          ([, teamData]) => parseInt(teamData.wins || "0") === 0
        );

        // Sort by playoff odds if all records are 0-0
        if (allZeroRecord) {
          sortedTeamData.sort(
            (a, b) =>
              (updatedManagerInfo[b[0]].playoffOdds || 0) -
              (updatedManagerInfo[a[0]].playoffOdds || 0)
          );
        }

        setManagerInfo(updatedManagerInfo);
        setSortedTeamDataFinal(sortedTeamData ? sortedTeamData : teamArray);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedLeagueID]);

  // Runs the league through a Monte Carlo playoff-odds simulation (see
  // src/lib/playoffSimulator.ts) instead of the old ad hoc win-probability
  // logic, which independently re-rolled each matchup from both teams'
  // perspectives (so a single game could register a "win" for both teams,
  // neither, or double-count) and re-simulated weeks that had already been
  // played on top of their real results.
  const calculatePlayoffOdds = async (
    managerInfo: ManagerInfo,
    rostersData: any[],
    leagueSettings: any,
    playoffStartWeek: number,
    currentNflWeek: number,
    p_data: any,
    matchupData: any
  ) => {
    const userIdByRosterId: { [rosterId: number]: string } = {};
    Object.entries(managerInfo).forEach(([userId, user]) => {
      if (user.roster_id) userIdByRosterId[Number(user.roster_id)] = userId;
    });
    const rosterIds = Object.keys(userIdByRosterId).map(Number);

    const currentRecord: {
      [rosterId: number]: { wins: number; losses: number; pointsFor: number };
    } = {};
    rosterIds.forEach((rosterId) => {
      const user = managerInfo[userIdByRosterId[rosterId]];
      currentRecord[rosterId] = {
        wins: parseInt(user.wins || "0"),
        losses: parseInt(user.losses || "0"),
        pointsFor:
          (parseFloat(user.team_points_for || "0") || 0) +
          (parseFloat(user.team_points_for_dec || "0") || 0) / 100,
      };
    });

    // Only simulate weeks that haven't been played yet - matchupData was
    // fetched for every week from 1 to playoffStartWeek - 1, but weeks
    // already in the books are reflected in currentRecord's wins already.
    const remainingRegularSeasonWeeks: SimMatchup[][] = [];
    const remainingRegularSeasonWeekNumbers: number[] = [];
    for (
      let week = Math.max(currentNflWeek, 1);
      week < playoffStartWeek;
      week++
    ) {
      const weekData = matchupData[week];
      if (!weekData) continue;
      const seenMatchupIds = new Set<any>();
      const games: SimMatchup[] = [];
      Object.values<any>(weekData).forEach((team: any) => {
        if (!team.roster_id || !team.opponent_id) return;
        if (seenMatchupIds.has(team.matchup_id)) return;
        const opponent = weekData[team.opponent_id];
        if (!opponent || !opponent.roster_id) return;
        seenMatchupIds.add(team.matchup_id);
        games.push({
          team1RosterId: Number(team.roster_id),
          team2RosterId: Number(opponent.roster_id),
        });
      });
      remainingRegularSeasonWeeks.push(games);
      remainingRegularSeasonWeekNumbers.push(week);
    }

    // this league's divisions, if it uses any - division winners get
    // playoff/bye priority in the simulation
    let divisions: SimDivision[] | undefined;
    if (leagueSettings.settings.divisions > 1) {
      const byDivision: { [id: number]: number[] } = {};
      rostersData.forEach((roster: any) => {
        const divisionId = roster.settings?.division;
        if (!divisionId) return;
        (byDivision[divisionId] ||= []).push(Number(roster.roster_id));
      });
      divisions = Object.entries(byDivision).map(([id, ids]) => ({
        id: Number(id),
        rosterIds: ids,
      }));
    }

    const odds = simulatePlayoffOdds({
      rosterIds,
      currentRecord,
      remainingRegularSeasonWeeks,
      remainingRegularSeasonWeekNumbers,
      // one representative week per round (division/wildcard, conference,
      // championship) - see src/lib/playoffSimulator.ts for why a two-game
      // round doesn't need two separate week numbers
      playoffWeekNumbers: [
        playoffStartWeek,
        playoffStartWeek + 1,
        playoffStartWeek + 2,
      ],
      getRating: (rosterId, week) =>
        calculateTeamProjection(
          managerInfo[userIdByRosterId[rosterId]]?.starters || [],
          week,
          p_data
        ),
      playoffTeams: leagueSettings.settings.playoff_teams || 6,
      twoGameRounds: leagueSettings.settings.playoff_round_type === 2,
      divisions,
    });

    const updatedManagerInfo = { ...managerInfo };
    rosterIds.forEach((rosterId) => {
      updatedManagerInfo[userIdByRosterId[rosterId]].playoffOdds =
        odds[rosterId].makePlayoffs;
    });

    return updatedManagerInfo;
  };

  const calculateTeamProjection = (
    starters: string[],
    week: number,
    p_data: any
  ) => {
    let teamProjection = 0;
    starters.forEach((playerId) => {
      const playerData = p_data && p_data[playerId];
      if (
        playerData &&
        playerData.wi &&
        playerData.wi[week.toString()] &&
        playerData.wi[week.toString()].p !== undefined
      ) {
        teamProjection += parseFloat(playerData.wi[week.toString()].p);
      }
    });
    return teamProjection;
  };

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

  const Table = () => {
    return (
      <div className="w-[90vw] xl:w-[60vw] shadow-lg rounded-lg overflow-x-scroll border-[1px] dark:border-[#1a1a1a] ">
        <table className="w-full">
          <thead>
            <tr className="border-b-[1px] border-[#1a1a1a] text-sm ">
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                League Manager
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                FP Rank
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                W
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                L
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                Playoff Odds
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                PF
              </th>
              <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                PA
              </th>
              {sortedTeamDataFinal.some(
                ([, user]) => user.streak !== undefined
              ) && (
                <th className="text-start p-4 font-medium text-[11px] md:text-[16px]">
                  Streak
                </th>
              )}
            </tr>
          </thead>
          <tbody className="text-[11px] md:text-[16px]">
            {sortedTeamDataFinal.map(([userId, user], index) => {
              return <TableRows key={userId} user={user} index={index} />;
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const TableRows: React.FC<{ user: ManagerInfo[string]; index: number }> = ({
    user,
    index,
  }) => {
    const rankOrdinal = numberToOrdinal(index + 1);

    return (
      <motion.tr
        layoutId={`row-${user.user_id}`}
        className="border-[1px] dark:border-[#1a1a1a]"
      >
        <td className="p-4 flex items-center gap-3 overflow-hidden ">
          <Image
            src={user.avatar}
            alt="Example user photo"
            width={30}
            height={30}
            className="rounded-full bg-slate-300 object-cover object-top "
          />
          <div>
            <span className="block mb-1 font-medium">{user.name}</span>
            <span className="block text-xs "></span>
          </div>
        </td>

        <td className="p-4">
          <div
            className={`flex items-center gap-2 font-medium ${
              rankOrdinal === "1st" && "text-[#af1222]"
            }`}
          >
            <span>{rankOrdinal}</span>
            {rankOrdinal === "1st" && <FiAward className="text-xl" />}{" "}
          </div>
        </td>

        <td className="p-4 font-medium">{user.wins}</td>
        <td className="p-4 font-medium">{user.losses}</td>
        <td className="p-4 font-medium">
          {user.playoffOdds !== undefined
            ? `${user.playoffOdds.toFixed(2)}%`
            : "N/A"}
        </td>

        <td className="p-4">
          {user.team_points_for !== undefined
            ? parseFloat(user.team_points_for) +
              (user.team_points_for_dec !== undefined
                ? parseFloat(user.team_points_for_dec) / 100
                : 0)
            : ""}
        </td>
        <td className="p-4">
          {user.team_points_against !== undefined
            ? parseFloat(user.team_points_against) +
              (user.team_points_against_dec !== undefined
                ? parseFloat(user.team_points_against_dec) / 100
                : 0)
            : ""}
        </td>
        {user.streak !== undefined && (
          <td className="p-4 font-medium ">
            <span className="flex items-center">
              {user.streak.slice(0, -1)}
              <p
                className={`p-1 font-bold ${
                  user.streak.slice(-1) === "L" ? "text-[red]" : "text-[green]"
                }`}
              >
                {user.streak.slice(-1)}
              </p>
            </span>
          </td>
        )}
      </motion.tr>
    );
  };

  return (
    <div className="w-[90vw] xl:w-[60vw] ">
      <h2 className="text-md xl:text-xl flex justify-center text-center font-bold mb-2">{`${localStorage.getItem(
        "selectedLeagueName"
      )} Overall Standings`}</h2>
      <Table />
    </div>
  );
};

export default Page;

const numberToOrdinal = (n: number) => {
  let ord = "th";

  if (n % 10 === 1 && n % 100 !== 11) {
    ord = "st";
  } else if (n % 10 === 2 && n % 100 !== 12) {
    ord = "nd";
  } else if (n % 10 === 3 && n % 100 !== 13) {
    ord = "rd";
  }

  return n + ord;
};
