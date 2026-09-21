"use client";
import React, { useState, useEffect, ReactNode } from "react";

import { motion } from "framer-motion";
import axios from "axios";
import LeagueManagersSelection from "../../../components/LeagueManagersSelection";
import Image from "next/image";
import { useSelectedManager } from "../../../context/SelectedManagerContext";
import { useRouter } from "next/navigation";
import { Spinner } from "@nextui-org/react";
import { BsDot } from "react-icons/bs";
import helmet from "../../../images/helmet2.png";
import useTimeChecks from "../../../libs/getTimes";
import GmScoutPanel from "../../../components/GmScoutPanel";

interface ScheduleData {
  [userId: string]: {
    avatar: string;
    name: string;
    roster_id?: string;
    user_id?: string;
    starters?: string[];
    team_points?: string;
    opponent?: string;
    matchup_id?: string;
  };
}

interface Starter {
  fn?: string;
  ln?: string;
  avatar?: string;
  points?: string;
  proj?: string;
  pos?: string;
}

interface ManagerMatchup {
  week?: string;
  matchup: MatchupMapData[];
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
  avatar: string;
  name: string;
  roster_id?: string;
  user_id?: string;
  starters?: string[];
  team_points?: string;
  opponent?: string;
  matchup_id?: string;
}

export default function Page() {
  const [scheduleDataFinal, setScheduleDataFinal] = useState<ScheduleData>({});
  const [loading, setLoading] = useState(true);
  const [defaultManager, setDefaultManager] = useState("");
  const [selectedManagerMatchups, setSelectedManagerMatchups] = useState<
    Map<string, ManagerMatchup[]>
  >(new Map());
  const [mnfEnd, setMnfEnd] = useState(false);
  const [morningSlateEnd, setMorningSlateEnd] = useState(false);
  const [afternoonSlateEnd, setAfternoonSlateEnd] = useState(false);
  const [snfEnd, setSnfEnd] = useState(false);
  const { selectedManagerr } = useSelectedManager();

  const [selectedManagerData, setSelectedManagerData] = useState();
  const [playersData, setPlayersData] = React.useState([]);
  const [activeTab, setActiveTab] = useState<"results" | "scout">("results");

  const REACT_APP_LEAGUE_ID: string | null =
    localStorage.getItem("selectedLeagueID");

  const selectedManager = localStorage.getItem("selectedManager");
  const router = useRouter();

  if (typeof localStorage !== "undefined") {
    if (
      localStorage.getItem("selectedLeagueID") === null ||
      localStorage.getItem("selectedLeagueID") === undefined
    ) {
      router.push("/");
    }
  }

  const getSchedule = async (week: number) => {
    try {
      const response = await axios.get<any>(
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/matchups/${week}`
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

  useEffect(() => {
    const fetchDataForWeek = async (week: number) => {
      try {
        const usersData = await getUsers();
        const rostersData = await getRoster();
        const scheduleData = await getSchedule(week);

        const updatedScheduleData: ScheduleData = {};
        const matchupMap = new Map<string, MatchupMapData[]>();

        for (const user of usersData) {
          updatedScheduleData[user.user_id] = {
            avatar: `https://sleepercdn.com/avatars/thumbs/${user.avatar}`,
            name: user.display_name,
            user_id: user.user_id,
          };
        }
        setDefaultManager(usersData[0].user_id);

        for (const roster of rostersData) {
          if (updatedScheduleData[roster.owner_id]) {
            updatedScheduleData[roster.owner_id].roster_id = roster.roster_id;
            updatedScheduleData[roster.owner_id].starters = roster.starters;
          }

          for (const matchup of scheduleData) {
            if (roster.roster_id === matchup.roster_id) {
              updatedScheduleData[roster.owner_id].matchup_id =
                matchup.matchup_id;
              updatedScheduleData[roster.owner_id].team_points = matchup.points;
            }
          }
        }

        setScheduleDataFinal(updatedScheduleData);

        for (const user in updatedScheduleData) {
          const userData = updatedScheduleData[user];
          if (userData.matchup_id) {
            if (!matchupMap.has(userData.matchup_id)) {
              matchupMap.set(userData.matchup_id, [userData]);
            } else {
              const matchupData = matchupMap.get(userData.matchup_id);
              if (matchupData && matchupData.length > 0) {
                const firstPlayer = matchupData[0];
                firstPlayer.opponent = userData.name;
                matchupMap.set(userData.matchup_id, [firstPlayer]);
                userData.opponent = firstPlayer.name;
                matchupMap.get(userData.matchup_id)?.push(userData);
              }
            }
          }
        }
        //console.log("ayo", matchupMap);

        for (const userId in updatedScheduleData) {
          const user = updatedScheduleData[userId];
          if (user.matchup_id) {
            // Check if matchup_id is not undefined
            const filteredMatchupData = matchupMap.get(user.matchup_id);
            if (filteredMatchupData) {
              if (user.user_id) {
                // Initialize existingMatchups with an empty array
                const existingMatchups: ManagerMatchup[] =
                  selectedManagerMatchups.get(user.user_id) || [];
                existingMatchups.push({
                  week: week.toString(),
                  matchup: filteredMatchupData,
                });
                selectedManagerMatchups.set(user.user_id, existingMatchups);
              }
            }
          }
        }

        for (const user in updatedScheduleData) {
          if (updatedScheduleData[user].user_id === selectedManager) {
            //setSelectedManagerData(updatedScheduleData[selectedManager]);
            //console.log("what was set ", updatedScheduleData[selectedManager]);
            break; // Exit the loop once the manager is found
          }
        }

        return matchupMap;
      } catch (error) {
        console.error("Error fetching data for week", week, ":", error);
        throw error;
      }
    };

    const fetchAllData = async () => {
      selectedManagerMatchups.clear();
      try {
        setLoading(true);
        for (let i = 1; i < 15; i++) {
          const weekMatchupMap = await fetchDataForWeek(i);

          // Handle additional processing or state updates if needed
        }
        setLoading(false);
      } catch (error) {
        console.error("Error fetching all data:", error);
        setLoading(false);
      }
    };

    fetchAllData();
  }, [REACT_APP_LEAGUE_ID, selectedManagerr]);
  //console.log("kabo", selectedManagerr);

  // useEffect(() => {
  //   // Update selectedManagerName when scheduleDataFinal or selectedManager changes

  //   for (const user in scheduleDataFinal) {
  //     if (scheduleDataFinal[user].user_id === selectedManager) {
  //       setSelectedManagerData(scheduleDataFinal[selectedManager]);
  //       //console.log("what was set ", scheduleDataFinal[selectedManager]);
  //       break; // Exit the loop once the manager is found
  //     }
  //   }
  // }, [scheduleDataFinal, selectedManager]);

  //console.log("weekly match", selectedManagerMatchups);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(
          "https://www.fantasypulseff.com/api/fetchPlayers",
          {
            method: "POST",
            body: REACT_APP_LEAGUE_ID,
          }
        );
        const playersData = await response.json();
        //console.log("Got it");
        setPlayersData(playersData);

        // Process and use the data as needed
        //console.log("WHO, ", playersData["4017"]);
        // Additional code that uses playersData goes here
      } catch (error) {
        console.error("Error while fetching players data:", error);
      }
    };

    fetchData();
  }, []);

  const {
    isSundayAfternoon,
    isSundayEvening,
    isSundayNight,
    isMondayNight,
    isWednesdayMidnight,
  } = useTimeChecks();

  useEffect(() => {
    setMnfEnd(isMondayNight);
  }, [
    isMondayNight,
    isSundayNight,
    isSundayEvening,
    isSundayAfternoon,
    isWednesdayMidnight,
  ]);

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
        <span>Loading Manager Data...</span>
      </div>
    );
  }

  //console.log(selectedManagerMatchups.get(defaultManager));

  const selectedManagerWeeklyResults = !selectedManager
    ? selectedManagerMatchups.get(defaultManager)
    : selectedManagerMatchups.get(selectedManager);

  const TranslateWrapper = ({
    children,
    reverse,
  }: {
    children: ReactNode;
    reverse: boolean;
  }) => {
    return (
      <motion.div
        initial={{ translateX: reverse ? "-100%" : "0%" }}
        animate={{ translateX: reverse ? "0%" : "-100%" }}
        transition={{ duration: 100, repeat: Infinity, ease: "linear" }}
        className="flex gap-4 px-2"
      >
        {children}
      </motion.div>
    );
  };

  const LogoItemsTop = () => (
    <div className="flex mr-3 justify-center">
      {selectedManagerWeeklyResults?.map((week) => {
        let selectedPlayer;
        let opponent;
        if (selectedManager) {
          if (selectedManager === week.matchup[0].user_id) {
            selectedPlayer = week.matchup[0];
            opponent = week.matchup[1];
          } else {
            selectedPlayer = week.matchup[1];
            opponent = week.matchup[0];
          }
        } else {
          if (defaultManager === week.matchup[0].user_id) {
            selectedPlayer = week.matchup[0];
            opponent = week.matchup[1];
          } else {
            selectedPlayer = week.matchup[1];
            opponent = week.matchup[0];
          }
        }

        return (
          <div
            className="flex flex-col items-center justify-center mr-2 "
            key={week.week}
          >
            <p className="text-[11px] font-bold mb-1">{` Week ${week.week}`}</p>
            <div
              className={
                (selectedPlayer.team_points ?? 0) ===
                (opponent.team_points ?? 0)
                  ? `flex flex-col justify-center items-center w-[100px] h-[80px] border-[1px] border-[#727070] rounded-2xl`
                  : (selectedPlayer.team_points ?? 0) >
                    (opponent.team_points ?? 0)
                  ? `flex flex-col justify-center items-center w-[100px] h-[80px] border-[1px] border-[green] rounded-2xl`
                  : `flex flex-col justify-center items-center w-[100px] h-[80px] border-[1px] border-[#af1222] rounded-2xl`
              }
            >
              <Image
                src={
                  opponent.avatar ===
                  "https://sleepercdn.com/avatars/thumbs/null"
                    ? helmet
                    : opponent.avatar
                }
                alt="avatar"
                width={30}
                height={30}
                className="rounded-full mb-2"
              />
              <p className="text-[10px] font-bold">
                {opponent.name.length >= 9
                  ? (opponent.name.match(/[A-Z]/g) || []).length > 3
                    ? opponent.name.slice(0, 10).toLowerCase()
                    : opponent.name.slice(0, 10)
                  : opponent.name}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );

  const activeManagerUserId = selectedManager || defaultManager;
  const activeManagerDisplay = scheduleDataFinal[activeManagerUserId];

  return (
    <div className="w-[95vw] xl:w-[60vw] mb-3">
      <LeagueManagersSelection />

      <div className="flex justify-center gap-4 mb-3 text-sm font-bold">
        <button
          onClick={() => setActiveTab("results")}
          className={
            activeTab === "results"
              ? "text-[#af1222] border-b-2 border-[#af1222] pb-1"
              : "text-gray-500 dark:text-gray-400 pb-1"
          }
        >
          Weekly Results
        </button>
        <button
          onClick={() => setActiveTab("scout")}
          className={
            activeTab === "scout"
              ? "text-[#af1222] border-b-2 border-[#af1222] pb-1"
              : "text-gray-500 dark:text-gray-400 pb-1"
          }
        >
          GM Scout
        </button>
      </div>

      {activeTab === "results" ? (
        <>
          <div className="text-center font-bold mb-2 flex justify-center items-center">
            <p>Weekly Results</p>
            <div className="ml-10 flex  justify-center items-center text-[9px] font-bold">
              <div className="flex items-center">
                <BsDot size={20} className=" text-[green]" />
                Win
              </div>
              <div className="flex items-center">
                <BsDot size={20} className=" text-[#af1222]" />
                Loss
              </div>
              <div className="flex items-center">
                <BsDot size={20} className=" text-[#727070]" />
                Not Played Yet
              </div>
            </div>
          </div>
          <div className="flex overflow-hidden py-1">
            <TranslateWrapper>
              <LogoItemsTop />
            </TranslateWrapper>
            <TranslateWrapper>
              <LogoItemsTop />
            </TranslateWrapper>
          </div>
        </>
      ) : (
        REACT_APP_LEAGUE_ID &&
        activeManagerUserId && (
          <div className="flex justify-center">
            <GmScoutPanel
              leagueId={REACT_APP_LEAGUE_ID}
              managerUserId={activeManagerUserId}
              managerName={activeManagerDisplay?.name || "Manager"}
              managerAvatar={activeManagerDisplay?.avatar || ""}
            />
          </div>
        )
      )}
    </div>
  );
}
