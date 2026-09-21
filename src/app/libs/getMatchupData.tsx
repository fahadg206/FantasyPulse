import React, { useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import { StaticImageData } from "next/image";
import logo from "../images/helmet2.png";

interface WeeklyInformation {
  [league_id: string]: {
    info?: ScheduleData;
  };
}

interface ScheduleData {
  [userId: string]: {
    avatar?: string | StaticImageData;
    name: string;
    roster_id?: string;
    user_id?: string;
    opponent_id?: string;
    starters?: string[];
    starters_points?: string[];
    players?: string[];
    players_points?: string[];
    starters_full_data?: Starter[];
    team_points?: string;
    opponent?: string;
    matchup_id?: string;
    wins?: string;
    losses?: string;
    streak?: string;
  };
}

interface Matchup {
  custom_points: null;
  matchup_id: string;
  players: string[];
  players_points: Record<string, number>;
  points: string;
  roster_id: string;
  starters: string[];
  starters_points: number[];
}

interface MatchupMapData {
  avatar?: string | StaticImageData;
  name: string;
  roster_id?: string;
  user_id?: string;
  opponent_id?: string;
  starters?: string[] | undefined;
  team_points?: string;
  opponent?: string;
  matchup_id?: string;
}

interface Starter {
  fn?: string;
  ln?: string;
  avatar?: string;
  points?: string;
  proj?: string;
  pos?: string;
}

export default async function getMatchupData(league_id: any, week: number) {
  const matchupMap = new Map<string, MatchupMapData[]>();

  const weeklyInfo: WeeklyInformation = {};

  const REACT_APP_LEAGUE_ID = league_id;

  const getSchedule = async () => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/matchups/${
          week && week >= 1 ? week : 1
        }`
      );

      return response.data;
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get matchups");
    }
  };

  const getUsers = async () => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/users`
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
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/rosters`
      );

      return response.data;
    } catch (err) {
      console.error(err);
      throw new Error("Failed to get rosters");
    }
  };

  function areObjectsEqual(obj1: Starter, obj2: Starter) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1 as Array<keyof Starter>) {
      if (obj1[key] !== obj2[key]) {
        return false;
      }
    }

    return true;
  }

  const updatedScheduleData: ScheduleData = {};

  const fetchData = async (playersData: any) => {
    try {
      const usersData = await getUsers();
      const rostersData = await getRoster();
      const scheduleData = await getSchedule();

      const usersWithRoster = usersData.filter((user: { user_id: string }) =>
        rostersData.some(
          (roster: { owner_id: string }) => roster.owner_id === user.user_id
        )
      );

      for (const user of usersWithRoster) {
        updatedScheduleData[user.user_id] = {
          avatar: user.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}`
            : logo,
          name: user.display_name,
          user_id: user.user_id,
        };
      }

      for (const roster of rostersData) {
        if (updatedScheduleData[roster.owner_id]) {
          updatedScheduleData[roster.owner_id].roster_id = roster.roster_id;
          updatedScheduleData[roster.owner_id].wins = roster.settings.wins;
          updatedScheduleData[roster.owner_id].losses = roster.settings.losses;
          updatedScheduleData[roster.owner_id].streak =
            roster.metadata?.streak || "N/A";
        }
      }

      for (const matchup of scheduleData) {
        for (const userId in updatedScheduleData) {
          if (updatedScheduleData[userId].roster_id === matchup.roster_id) {
            updatedScheduleData[userId].matchup_id = matchup.matchup_id;
            updatedScheduleData[userId].team_points = matchup.points;
            updatedScheduleData[userId].starters_points =
              matchup.starters_points;
            updatedScheduleData[userId].players = matchup.players;
            updatedScheduleData[userId].players_points = matchup.players_points;
            updatedScheduleData[userId].starters = matchup.starters;
          }
        }
      }

      for (const userId in updatedScheduleData) {
        if (updatedScheduleData.hasOwnProperty(userId)) {
          if (!updatedScheduleData[userId].starters_full_data) {
            updatedScheduleData[userId].starters_full_data = [{}];
          }
          if (updatedScheduleData[userId]?.starters) {
            for (const starter of updatedScheduleData[userId]?.starters || []) {
              if (starter != "0" && playersData[starter]) {
                const starter_data = {
                  fn: playersData[starter].fn,
                  ln: playersData[starter].ln,
                  avatar:
                    playersData[starter.toString()].pos == "DEF"
                      ? `https://sleepercdn.com/images/team_logos/nfl/${starter.toLowerCase()}.png`
                      : `https://sleepercdn.com/content/nfl/players/thumb/${starter}.jpg`,
                  points:
                    updatedScheduleData[userId]?.players_points?.[
                      parseInt(starter)
                    ] || "0",
                  pos: playersData[starter].pos,
                  proj: playersData[starter].wi[week.toString()].p,
                };
                if (
                  updatedScheduleData[userId]?.starters_full_data &&
                  !updatedScheduleData[userId]?.starters_full_data?.some(
                    (item) => {
                      return areObjectsEqual(item, starter_data);
                    }
                  )
                ) {
                  updatedScheduleData[userId]?.starters_full_data?.push(
                    starter_data
                  );
                } else {
                  updatedScheduleData[userId].starters_full_data = [
                    {
                      fn: playersData[starter].fn,
                      ln: playersData[starter].ln,
                      avatar:
                        playersData[starter.toString()].pos === "DEF"
                          ? `https://sleepercdn.com/images/team_logos/nfl/${starter.toLowerCase()}.png`
                          : `https://sleepercdn.com/content/nfl/players/thumb/${starter}.jpg`,
                      points:
                        updatedScheduleData[userId]?.players_points?.[
                          parseInt(starter)
                        ] || "0",
                      pos: playersData[starter].pos,
                      proj: playersData[starter].wi[week.toString()].p,
                    },
                  ];
                }
              }
            }
          }
        }
      }

      for (const userId in updatedScheduleData) {
        const userData = updatedScheduleData[userId];
        if (userData.matchup_id) {
          if (!matchupMap.has(userData.matchup_id)) {
            matchupMap.set(userData.matchup_id, [userData]);
          } else {
            const matchupData = matchupMap.get(userData.matchup_id);
            if (matchupData && matchupData.length > 0) {
              const firstPlayer = matchupData[0];
              firstPlayer.opponent = userData.name;
              firstPlayer.opponent_id = userData.user_id;
              matchupMap.set(userData.matchup_id, [firstPlayer]);
              userData.opponent = firstPlayer.name;
              // This used to be userData.user_id - a team's own id, not its
              // opponent's - so every team's opponent_id pointed at itself.
              // The playoff simulator (src/lib/playoffSimulator.ts, wired
              // in via standings/page.tsx) pairs teams via this exact
              // field, so this alone was enough to silently turn its
              // Monte Carlo into every team "playing" a mirror of itself
              // for every remaining week.
              userData.opponent_id = firstPlayer.user_id;
              matchupMap.get(userData.matchup_id)?.push(userData);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    return { matchupMap, updatedScheduleData };
  };

  async function fetchPlayersData() {
    try {
      const playersResponse = await fetch("/api/fetchPlayers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ leagueId: REACT_APP_LEAGUE_ID }),
      });
      const playersData = await playersResponse.json();
      return playersData;
    } catch (error) {
      console.error("Error while fetching players data:", error);
      return [];
    }
  }

  const playersData = await fetchPlayersData();
  const response = await fetchData(playersData);

  return response;
}
