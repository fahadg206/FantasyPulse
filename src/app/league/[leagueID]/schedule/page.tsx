"use client";

import React, { useEffect, useState } from "react";
import getMatchupMap from "../../../libs/getMatchupData";
import Image from "next/image";
import uuid from "uuid";
import SchedulePoll from "../../../components/SchedulePoll";
import axios, { AxiosResponse } from "axios";
import { HiOutlineArrowSmLeft, HiOutlineArrowSmRight } from "react-icons/hi";
import { BsDot } from "react-icons/bs";
import {
  Link,
  Button,
  Element,
  Events,
  animateScroll as scroll,
  scrollSpy,
  scroller,
} from "react-scroll";
import useTimeChecks from "../../../libs/getTimes";
import { useRouter } from "next/navigation";
import { players } from "@/server/playerInfo";
import MatchupFeed from "../../../components/MatchupFeed";
import MatchupBigPlayWatcher from "../../../components/MatchupBigPlayWatcher";
import AnimatedNumber from "../../../components/AnimatedNumber";
import { BiSolidNews } from "react-icons/bi";

interface NflState {
  season: string;
  display_week: number;
  season_type: string;
  // Add other properties as needed
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

interface ScheduleData {
  [userId: string]: {
    avatar?: string;
    name: string;
    roster_id?: string;
    user_id?: string;
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

interface Starter {
  fn?: string;
  ln?: string;
  avatar?: string;
  points?: string;
  proj?: string;
  pos?: string;
}

let initialize = false;
let pollnsSet = false;

export default function Schedule() {
  const [loading, setLoading] = useState(true);

  const [matchupMap, setMatchupMap] = useState<Map<
    string,
    MatchupMapData[]
  > | null>(null);
  const [matchupMapPoll, setMatchupMapPoll] = useState<Map<
    string,
    MatchupMapData[]
  > | null>(null);
  const [counter, setCounter] = useState(1);
  const [scheduleDataFinal, setScheduleDataFinal] = useState<ScheduleData>({});
  const [team1Name, setTeam1Name] = useState("");
  const [team2Name, setTeam2Name] = useState("");

  const [mnfEnd, setMnfEnd] = useState(false);
  const [morningSlateEnd, setMorningSlateEnd] = useState(false);
  const [afternoonSlateEnd, setAfternoonSlateEnd] = useState(false);
  const [snfEnd, setSnfEnd] = useState(false);
  const [nflState, setNflState] = useState<NflState>();
  const [playersData, setPlayersData] = React.useState([]);
  const [expandedFeeds, setExpandedFeeds] = useState<Set<string>>(new Set());
  const [scoringSettings, setScoringSettings] = useState<{
    [stat: string]: number;
  }>({});

  const toggleFeed = (matchupID: string) => {
    setExpandedFeeds((prev) => {
      const next = new Set(prev);
      if (next.has(matchupID)) {
        next.delete(matchupID);
      } else {
        next.add(matchupID);
      }
      return next;
    });
  };
  const [checkTimeFunction, setCheckTimeFunction] = useState<
    (() => void) | undefined
  >(undefined);

  const router = useRouter();

  const REACT_APP_LEAGUE_ID = localStorage.getItem("selectedLeagueID");

  if (typeof localStorage !== "undefined") {
    if (
      localStorage.getItem("selectedLeagueID") === null ||
      localStorage.getItem("selectedLeagueID") === undefined
    ) {
      router.push("/");
    }
  }

  const getNflState = async (): Promise<NflState> => {
    try {
      const res: AxiosResponse<NflState> = await axios.get<NflState>(
        `https://api.sleeper.app/v1/state/nfl`
      );

      const data: NflState = res.data;

      if (res.status === 200) {
        //console.log("Here's the nfl Data:", data);
      } else {
        // Handle other status codes or error cases
      }
      return data;
    } catch (err) {
      console.error(err);
      // Handle the error case here, return an appropriate value, or throw an error
      throw new Error("Failed to get NFL state");
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
        const playersData = await playersResponse.json();
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

  useEffect(() => {
    const fetchScoringSettings = async () => {
      try {
        const response = await axios.get<any>(
          `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}`
        );
        setScoringSettings(response.data.scoring_settings || {});
      } catch (error) {
        console.error("Error fetching scoring settings:", error);
      }
    };
    if (REACT_APP_LEAGUE_ID) fetchScoringSettings();
  }, [REACT_APP_LEAGUE_ID]);

  const { isSundayAfternoon, isSundayEvening, isSundayNight, isMondayNight } =
    useTimeChecks();

  useEffect(() => {
    setMnfEnd(isMondayNight);
    setSnfEnd(isSundayNight);
    setAfternoonSlateEnd(isSundayEvening);
    setMorningSlateEnd(isSundayAfternoon);
  }, [isMondayNight, isSundayNight, isSundayEvening, isSundayAfternoon]);

  // useEffect(() => {
  //   checkTime(); // Initial check
  //   const intervalId = setInterval(checkTime, 60000); // Check every minute

  //   return () => clearInterval(intervalId); // Cleanup interval when component unmounts
  // }, []);

  let matchupText;

  useEffect(() => {
    async function fetchMatchupData() {
      try {
        setLoading(true);
        if (counter) {
          const matchupMapData = await getMatchupMap(
            REACT_APP_LEAGUE_ID,
            counter
          );
          setMatchupMap(matchupMapData.matchupMap);
          setScheduleDataFinal(matchupMapData.updatedScheduleData);
        }

        const nflState = await getNflState();
        if (!initialize) {
          setCounter(!nflState.display_week ? 1 : nflState.display_week);
          initialize = true;
        }
        //console.log(nflState.display_week);
        setNflState(nflState);
        const matchupMapDataPoll = await getMatchupMap(
          REACT_APP_LEAGUE_ID,
          nflState?.display_week
        );
        setMatchupMapPoll(matchupMapDataPoll.matchupMap);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching matchup data:", error);
      }
    }

    fetchMatchupData();
  }, [REACT_APP_LEAGUE_ID, counter]);

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
        <span>Loading Schedule...</span>
      </div>
    );
  }

  matchupText = Array.from(matchupMap || []).map(([matchupID, matchupData]) => {
    const team1 = matchupData[0];
    const team2 = matchupData[1];

    if (counter === nflState?.display_week) {
      //console.log("kaboooooooooooo");
    }
    let team1Proj = 0.0;
    let team2Proj = 0.0;
    //console.log("team 1, ", team1.starters);
    // ...

    if (team1?.starters) {
      for (const currPlayer of team1.starters) {
        if (playersData[currPlayer]) {
          if (
            playersData[currPlayer] &&
            playersData[currPlayer].wi &&
            playersData[currPlayer].wi[counter?.toString()] &&
            playersData[currPlayer].wi[counter?.toString()].p !== undefined
          ) {
            team1Proj += parseFloat(
              playersData[currPlayer].wi[counter?.toString()].p
            );
          }
        }
      }
    }

    if (team2?.starters) {
      for (const currPlayer of team2.starters) {
        if (playersData[currPlayer]) {
          if (
            playersData[currPlayer] &&
            playersData[currPlayer].wi &&
            playersData[currPlayer].wi[counter?.toString()] &&
            playersData[currPlayer].wi[counter?.toString()].p !== undefined
          ) {
            team2Proj += parseFloat(
              playersData[currPlayer].wi[counter?.toString()].p
            );
          }
        }
      }
    }

    const starters1 =
      scheduleDataFinal[team1.user_id]?.starters_full_data || [];
    const starters2 =
      scheduleDataFinal[team2.user_id]?.starters_full_data || [];

    const starters1Points = scheduleDataFinal[team1.user_id]?.starters_points;
    const starters2Points = scheduleDataFinal[team2.user_id]?.starters_points;

    //check to see if every player on BOTH teams have more points than 0
    const team1Played = scheduleDataFinal[team1.user_id].starters_points.every(
      (starterPoints) => {
        return starterPoints !== 0;
      }
    );
    const team2Played = scheduleDataFinal[team2.user_id].starters_points.every(
      (starterPoints) => {
        return starterPoints !== 0;
      }
    );

    team1Played &&
    team2Played &&
    (morningSlateEnd || afternoonSlateEnd || snfEnd || mnfEnd)
      ? "show final and top scorers"
      : "match still live";

    // Remove empty objects from starters arrays
    const nonEmptyStarters1 = starters1.filter(
      (starter) => Object.keys(starter).length > 0
    );
    const nonEmptyStarters2 = starters2.filter(
      (starter) => Object.keys(starter).length > 0
    );

    // Sort the non-empty starters by points in descending order
    const sortedStarters1 = [...nonEmptyStarters1].sort(
      (a, b) => b.points - a.points
    );

    const sortedStarters2 = [...nonEmptyStarters2].sort(
      (a, b) => b.points - a.points
    );

    // Extract the top two highest scorers
    const topTwoScorers1 = sortedStarters1.slice(0, 2);
    const topTwoScorers2 = sortedStarters2.slice(0, 2);

    //console.log("Top two scores for team 1:", topTwoScorers1);
    //console.log("Top two scores for team 2:", topTwoScorers2);

    let preGame;
    let liveGame;
    let postGame;

    //check if we're in current week. If we are, display poll. Else, display over/under.
    if (
      (parseFloat(team1.team_points) === 0 &&
        parseFloat(team2.team_points) === 0) ||
      nflState?.display_week < counter
    ) {
      preGame = true;
      postGame = false;
      liveGame = false;
    }

    //live game
    if (
      (parseFloat(team1.team_points) !== 0 ||
        parseFloat(team2.team_points) !== 0) &&
      (starters1Points.includes(0) || starters2Points.includes(0))
    ) {
      liveGame = true;
      preGame = false;
      postGame = false;
    }

    //postgame
    if (
      nflState?.display_week > counter ||
      (team1Played &&
        team2Played &&
        (morningSlateEnd || afternoonSlateEnd || snfEnd))
    ) {
      postGame = true;
      preGame = false;
      liveGame = false;
    }
    if (mnfEnd && counter === nflState?.display_week) {
      postGame = true;
      preGame = false;
      liveGame = false;
    }
    //console.log(nflState?.display_week < counter);
    //console.log(postGame);

    let overUnderText = (
      <div
        className={team1.team_points && team2.team_points ? `hidden` : `block`}
      >
        <p className="w-[40vw] xl:w-[30vw] text-center text-[15px]">
          O/U: {Math.round(team1Proj + team2Proj)}
        </p>
        <p className="w-[40vw] xl:w-[30vw] text-center text-[15px] text-[grey]">
          {team1Proj > team2Proj
            ? team1?.name + " -" + Math.round(team1Proj - team2Proj)
            : team2?.name + " -" + Math.round(team2Proj - team1Proj)}
        </p>
      </div>
    );
    let showPoll;

    const matchupPoll = matchupMapPoll?.get(matchupID);

    if (matchupPoll) {
      let team1Poll = matchupPoll[0];
      let team2Poll = matchupPoll[1];
      //console.log(team1Poll.name, team2Poll.name);

      showPoll = (
        <div
          className={
            mnfEnd ? `hidden` : `w-[50vw] xl:w-[35vw] flex justify-center`
          }
        >
          <SchedulePoll
            team1Name={team1Poll.name}
            team2Name={team2Poll.name}
            matchup_id={matchupID}
            nflWeek={nflState?.display_week}
            liveGame={liveGame}
            mnfEnd={mnfEnd}
          />
        </div>
      );

      // Continue using team1Poll and team2Poll as needed
    } else {
      // Handle the case when matchupPoll is undefined
    }

    let showLiveText = (
      <div className="w-[50vw] xl:w-[35vw] flex flex-col h-[150px] justify-around items-center">
        <p className="italic text-[14px] text-[#1a1a1a] dark:text-[#979090] text-center">
          Kabo was voted to win by 70% of league members!
        </p>{" "}
        <p className="text-[12px] text-[#af1222] flex items-center animate-pulse">
          <BsDot /> LIVE
        </p>
      </div>
    );

    let team1TopScorers = (
      <div className="team1 topscorers">
        {
          <div className="top-scorers">
            <ul className=" flex w-[40vw] xl:w-[20vw] justify-center ">
              {topTwoScorers1.map((player, index) => {
                const playerName = player.fn?.charAt(0) + ". " + player.ln;
                const points = player.points;

                // Calculate the length of the player name and points
                const totalContentLength =
                  playerName.length + (points && points.toString().length);

                // Calculate the scale factor based on content length
                const scaleFactor = Math.min(1, 100 / totalContentLength);

                // Calculate adjusted font size and image size

                let imageSize = scaleFactor * 80;
                if (player.pos === "DEF") {
                  imageSize = scaleFactor * 55;
                }

                return (
                  <li
                    key={index}
                    className="flex flex-col  items-center justify-center space-x-2 w-[160px] h-[80px] xl:w-[100px] xl:h-[80px]  "
                  >
                    <Image
                      src={player.avatar}
                      alt="Player Avatar"
                      width={imageSize}
                      height={imageSize}
                      className={`rounded-full w-[${imageSize}] h-[${imageSize}]`}
                    />
                    <div className="flex flex-col text-[8px] md:text-[9px] xl:text-[12px]">
                      <p>{playerName}</p>
                      <p className="text-[8px] xl:text-[10px] w-full text-center">
                        {points}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        }
      </div>
    );

    let team2TopScorers = (
      <div className="team2 topscorers">
        {
          <div className="top-scorers mt-4">
            <p className="font-bold mb-2"></p>
            <ul className=" flex justify-center w-[40vw] xl:w-[20vw] ">
              {topTwoScorers2.map((player, index) => {
                const playerName = player.fn?.charAt(0) + ". " + player.ln;
                const points = player.points;

                // Calculate the length of the player name and points
                const totalContentLength =
                  playerName.length + (points && points.toString().length);

                // Calculate the scale factor based on content length
                const scaleFactor = Math.min(1, 100 / totalContentLength);

                // Calculate adjusted font size and image size

                let imageSize = scaleFactor * 80;
                if (player.pos === "DEF") {
                  imageSize = scaleFactor * 55;
                }

                return (
                  <li
                    key={index}
                    className="flex flex-col items-center justify-center space-x-2 w-[160px] h-[80px] xl:w-[100px] xl:h-[95px] "
                  >
                    <Image
                      src={player.avatar}
                      alt="Player Avatar"
                      width={imageSize}
                      height={imageSize}
                      className={`w-[${imageSize}] h-[${imageSize}]`}
                    />
                    <div className="flex flex-col text-[8px] md:text-[9px] xl:text-[12px]">
                      <p>{playerName}</p>
                      <p className="text-[8px] xl:text-[10px] w-full text-center">
                        {points}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        }
      </div>
    );

    return (
      <div
        key={matchupID}
        className=" flex flex-col items-center gap-5 mt-2 duration-500 w-[95vw] xl:w-[60vw]"
      >
        <Element name={matchupID} className="element ">
          <div
            className={
              counter === nflState?.display_week
                ? `border border-black  dark:border-[#1a1a1a] rounded w-[95vw] xl:w-[60vw] flex items-center justify-center md:h-[26vw] xl:h-[17vw]`
                : `border border-black  dark:border-[#1a1a1a] rounded w-[95vw] xl:w-[60vw] flex items-center justify-center h-[25vh] md:h-[25vw] xl:h-[17vw]`
            }
          >
            <div className="flex flex-col w-[45vw] xl:w-[25vw] items-center mr-1 xl:ml-5 ">
              {/* 1 styling is for polls, 2 is for postgame players*/}
              <div
                className={
                  preGame || liveGame
                    ? `1 team1 flex justify-between items-center  w-[45vw] xl:w-[25vw] mb-5`
                    : `2 team1 flex justify-around items-center  w-[95vw] xl:w-[60vw] `
                }
              >
                <div className="flex items-center w-full justify-around">
                  <div className="flex">
                    {" "}
                    <Image
                      className="rounded-full mr-2 lg:w-[40px] lg:h-[40px] "
                      src={team1.avatar}
                      alt="avatar"
                      width={30}
                      height={30}
                    />
                    <div className="text-[12px] lg:text-[20px] font-bold flex gap-2 items-center">
                      {team1.name.length >= 9
                        ? (team1.name.match(/[A-Z]/g) || []).length > 3
                          ? team1.name.slice(0, 10).toLowerCase()
                          : team1.name.slice(0, 10)
                        : team1.name}
                      <p className="text-[10px] sm:block italic font-bold text-[#949494]">{`${
                        scheduleDataFinal[team1.user_id].wins
                      } - ${scheduleDataFinal[team1.user_id].losses}`}</p>
                    </div>
                  </div>

                  <div
                    className={
                      postGame
                        ? `block text-[11px] md:text-[14px] italic`
                        : `hidden`
                    }
                  >
                    <AnimatedNumber
                      value={parseFloat(team1.team_points || "0")}
                    />
                  </div>
                </div>

                {/* TopScorers */}

                {postGame && team1TopScorers}
              </div>
              <div
                className={
                  preGame || liveGame
                    ? `1 team2 flex justify-between items-center  w-[45vw] xl:w-[25vw] `
                    : `2 team2 flex justify-around items-center  w-[95vw] xl:w-[60vw] `
                }
              >
                <div className="flex items-center w-full justify-around ">
                  <div className="flex">
                    {" "}
                    <Image
                      className="rounded-full mr-2 lg:w-[40px] lg:h-[40px]"
                      src={team2.avatar}
                      alt="avatar"
                      width={30}
                      height={30}
                    />
                    <div className="text-[12px] lg:text-[20px] font-bold flex gap-2 items-center">
                      {team2.name.length >= 9
                        ? (team2.name.match(/[A-Z]/g) || []).length > 3
                          ? team2.name.slice(0, 10).toLowerCase()
                          : team2.name.slice(0, 10)
                        : team2.name}
                      <p className="text-[10px] sm:block italic font-bold text-[#949494]">{`${
                        scheduleDataFinal[team2.user_id].wins
                      } - ${scheduleDataFinal[team2.user_id].losses}`}</p>
                    </div>
                  </div>

                  <div
                    className={
                      postGame
                        ? `block text-[11px] md:text-[14px] italic`
                        : `hidden`
                    }
                  >
                    <AnimatedNumber
                      value={parseFloat(team2.team_points || "0")}
                    />
                  </div>
                </div>
                {/* TopScorers team 2 */}
                {postGame && team2TopScorers}
              </div>

              {(mnfEnd || postGame) && counter <= nflState?.display_week ? (
                <p className="text-[12px] w-[75vw] xl:w-[40vw] flex  font-bold">
                  {"FINAL"}
                </p>
              ) : (
                <p className="hidden">{"FINAL"}</p>
              )}
            </div>

            {preGame && counter && nflState?.display_week === counter ? (
              showPoll
            ) : (preGame || liveGame || postGame) &&
              nflState?.display_week < counter ? (
              overUnderText
            ) : (
              <div
                className={
                  postGame || nflState?.display_week < counter
                    ? `hidden`
                    : "block"
                }
              >
                {showPoll}
              </div>
            )}

            {/* {liveGame && showLiveText} */}
          </div>
        </Element>

        <button
          onClick={() => toggleFeed(matchupID)}
          className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-[#af1222] dark:hover:text-[#af1222]"
        >
          <BiSolidNews />
          {expandedFeeds.has(matchupID) ? "Hide Feed" : "Feed"}
        </button>

        {team1?.user_id && team2?.user_id && nflState?.season && (
          <MatchupBigPlayWatcher
            week={counter}
            season={nflState.season}
            team1={{
              userId: team1.user_id,
              name: team1.name,
              starterSleeperIds: team1.starters || [],
            }}
            team2={{
              userId: team2.user_id,
              name: team2.name,
              starterSleeperIds: team2.starters || [],
            }}
            playersData={playersData as { [sleeperId: string]: any }}
            scoringSettings={scoringSettings}
            enabled={counter === nflState?.display_week}
          />
        )}

        {expandedFeeds.has(matchupID) &&
          team1?.user_id &&
          team2?.user_id &&
          nflState?.season && (
            <MatchupFeed
              week={counter}
              season={nflState.season}
              team1={{
                userId: team1.user_id,
                name: team1.name,
                starterSleeperIds: team1.starters || [],
              }}
              team2={{
                userId: team2.user_id,
                name: team2.name,
                starterSleeperIds: team2.starters || [],
              }}
              playersData={playersData as { [sleeperId: string]: any }}
              scoringSettings={scoringSettings}
            />
          )}
      </div>
    );
  });

  const handleCounterChange = (newCounter: number) => {
    if (newCounter >= 1 && newCounter <= 14) {
      setCounter(newCounter);
    }
  };
  //console.log("counter", counter);

  return (
    <div className=" flex flex-col items-center mt-1">
      <div className="flex flex-col items-center">
        <p className="font-bold italic">{`Week: ${counter}`}</p>

        <div className="flex">
          <p
            className="cursor-pointer"
            onClick={() => handleCounterChange(counter - 1)}
          >
            <HiOutlineArrowSmLeft size={38} />
          </p>{" "}
          <p
            className="cursor-pointer"
            onClick={() => handleCounterChange(counter + 1)}
          >
            <HiOutlineArrowSmRight size={38} />
          </p>
        </div>
      </div>
      {matchupText}
    </div>
  );
}
