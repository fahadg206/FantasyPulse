"use client";
import React, { useEffect, useState } from "react";
import Imran from "../images/scary_imran.png";
import Image from "next/image";
import axios from "axios";
import { Spinner } from "@nextui-org/react";
import { db, storage } from "../firebase";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
} from "firebase/firestore/lite";
import { QuerySnapshot, onSnapshot, doc } from "firebase/firestore";
import getMatchupMap from "../../app/libs/getMatchupData";
import { useRouter } from "next/navigation";
import * as Scroll from "react-scroll";
import Link from "next/link";
import {
  Link as SmoothLink,
  Button,
  Element,
  Events,
  animateScroll as scroll,
  scrollSpy,
  scroller,
} from "react-scroll";
import useTimeChecks from "../libs/getTimes";
import { BsDot } from "react-icons/bs";
import AnimatedNumber from "./AnimatedNumber";

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
  };
}

interface WeeklyInformation {
  [league_id: string]: {
    info?: ScheduleData;
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
  avatar: string;
  name: string;
  roster_id?: string;
  user_id?: string;
  starters?: string[];
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
}

interface PlayerData {
  wi?: {
    [week: string]: {
      p?: string;
    };
  };
  // Add other properties if needed
}

export default function Scoreboard() {
  const [schedule, setSchedule] = useState<Matchup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [mnfEnd, setMnfEnd] = useState(false);
  const [morningSlateEnd, setMorningSlateEnd] = useState(false);
  const [afternoonSlateEnd, setAfternoonSlateEnd] = useState(false);
  const [snfEnd, setSnfEnd] = useState(false);
  const [wednesdayNight, setWednesdaynNight] = useState(false);
  const [timecheckComplete, setTimecheckComplete] = useState(false);
  const [scheduleDataFinal, setScheduleDataFinal] = useState<ScheduleData>({});
  const [playersData, setPlayersData] =
    React.useState<Record<string, PlayerData>>();
  const [week, setWeek] = useState<number>();

  const weeklyInfo: WeeklyInformation = {};

  const [matchupMap, setMatchupMap] = useState<Map<string, MatchupMapData[]>>(
    new Map()
  );

  let initialSelectedLeagueID = "";

  // Check if localStorage is defined before using it
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    initialSelectedLeagueID = localStorage.getItem("selectedLeagueID") || "";
  }
  const REACT_APP_LEAGUE_ID =
    typeof window !== "undefined" && typeof localStorage !== "undefined"
      ? localStorage.getItem("selectedLeagueID")
      : null;

  const [leagueID, setLeagueID] = useState(initialSelectedLeagueID);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      setLeagueID(localStorage.getItem("selectedLeagueID") || "");
      router.refresh();
    }
  }, [router]);

  const {
    isSundayAfternoon,
    isSundayEvening,
    isSundayNight,
    isMondayNight,
    isWednesdayMidnight,
  } = useTimeChecks();

  useEffect(() => {
    setMnfEnd(isMondayNight);
    setSnfEnd(isSundayNight);
    setAfternoonSlateEnd(isSundayEvening);
    setMorningSlateEnd(isSundayAfternoon);
    setWednesdaynNight(isWednesdayMidnight);
    setTimecheckComplete(true);
  }, [
    isMondayNight,
    isSundayNight,
    isSundayEvening,
    isSundayAfternoon,
    isWednesdayMidnight,
  ]);

  function updateDbStorage(weeklyData: any, previewData: ScheduleData) {
    if (leagueID) {
      const storageRef = ref(storage, `files/${leagueID}.txt`);

      //Uncomment to upload textfile to firebase storage

      // const articleMatchupData: ScheduleData = JSON.parse(
      //   JSON.stringify(weeklyData)
      // );

      // console.log("recap", articleMatchupData);
      const previewMatchupData: ScheduleData = JSON.parse(
        JSON.stringify(previewData)
      );
      // console.log("preview", previewMatchupData);
      for (const matchupId in weeklyData) {
        let matchup = weeklyData[matchupId];

        matchup.forEach((team) => {
          // Delete properties from the matchup object
          delete team.starters;
          delete team.starters_points;
          delete team.players;
          delete team.players_points;
          delete team.roster_id;
          delete team.user_id;
          delete team.avatar;

          // Check if starters_full_data exists before iterating over it
          if (team.starters_full_data) {
            for (const starter of team.starters_full_data) {
              delete starter.avatar;
              delete starter.proj;
            }
          }
        });
      }

      for (const matchupId in previewMatchupData) {
        const matchup = previewMatchupData[matchupId];

        // Delete properties from the matchup object
        delete matchup.starters;
        delete matchup.starters_points;
        delete matchup.players;
        delete matchup.players_points;
        delete matchup.roster_id;
        delete matchup.user_id;
        delete matchup.avatar;

        // Check if starters_full_data exists before iterating over it
        if (matchup.starters_full_data) {
          for (const starter of matchup.starters_full_data) {
            delete starter.avatar;
            delete starter.points;
          }
        }
      }

      //console.log("data ", articleMatchupData);

      const textContent = JSON.stringify(weeklyData);
      const previewTextContent = JSON.stringify(
        Object.values(previewMatchupData)
      );

      const previewRef = ref(storage, `files/${leagueID}_preview.txt`);
      // Function to add content only if it's different
      addContentIfDifferent(textContent, storageRef);
      addContentIfDifferent(previewTextContent, previewRef);
    }
  }

  function addContentIfDifferent(newContent: any, readingRef: any) {
    // Get the current contents of the file
    //uploadNewContent(newContent, readingRef);
    getDownloadURL(readingRef)
      .then(function (url) {
        // Fetch the current contents using the URL
        fetch(url)
          .then((response) => response.text())
          .then((existingContent) => {
            if (
              newContent.length > 3 &&
              (!existingContent || existingContent !== newContent)
            ) {
              //console.log("newcontent", newContent);
              // If existingContent is empty or different from new content, upload the new content
              uploadNewContent(newContent, readingRef);
            } else {
              //console.log("New content is the same as existing content.");
            }
          })
          .catch(function (error) {
            console.error("Error fetching existing content:", error);
          });
      })
      .catch(function (error) {
        if (error.code === "storage/object-not-found") {
          // Handle the case when the object (file) is not found in storage
          uploadNewContent(newContent, readingRef);
        } else {
          //console.error("Error getting download URL:", error);
        }
      });
  }

  // Function to upload new content
  function uploadNewContent(content: any, storageRef: any) {
    uploadString(storageRef, content, "raw")
      .then(() => {
        //console.log("Text file uploaded to Firebase Cloud Storage.");
      })
      .catch((error) => {
        console.error("Error uploading text file:", error);
      });
  }

  function mapToObject(map: Map<string, any>) {
    const obj = {};
    for (let [key, value] of map) {
      obj[key] = value;
    }
    return obj;
  }

  useEffect(() => {
    async function fetchMatchupData() {
      try {
        const response = await axios.get(
          `https://api.sleeper.app/v1/state/nfl`
        );

        const nflState = response.data;
        let week = 1;
        if (nflState.season_type === "regular") {
          week = nflState.display_week;
        } else if (nflState.season_type === "post") {
          week = 18;
        }
        setWeek(week);
        let id = null;

        if (
          typeof window !== "undefined" &&
          typeof localStorage !== "undefined" &&
          localStorage.getItem("selectedLeagueID")
        ) {
          id = window.localStorage.getItem("selectedLeagueID");
        }
        //console.log("ID", id);

        const matchupMapData = await getMatchupMap(id, week);
        const matchupMapDataCopy = await getMatchupMap(id, week);

        const matchupObj = mapToObject(matchupMapDataCopy.matchupMap);

        //console.log("Matchups: ", matchupObj);

        setMatchupMap(matchupMapData.matchupMap);

        //console.log("being set", matchupMapData.matchupMap);
        setScheduleDataFinal(matchupMapData.updatedScheduleData);

        const currentTime = new Date(); // Assuming this is in the "America/Los_Angeles" time zone

        // Calculate the next Wednesday midnight
        const nextWednesdayMidnight = new Date(currentTime);
        nextWednesdayMidnight.setDate(
          currentTime.getDate() + ((3 + 7 - currentTime.getDay()) % 7)
        );
        nextWednesdayMidnight.setHours(0, 0, 0, 0);

        // Calculate the current Wednesday midnight
        const currentWednesdayMidnight = new Date(nextWednesdayMidnight);
        currentWednesdayMidnight.setDate(nextWednesdayMidnight.getDate() - 7);

        // Calculate the next Tuesday midnight
        const nextTuesdayMidnight = new Date(currentTime);
        nextTuesdayMidnight.setDate(
          currentTime.getDate() + ((2 + 7 - currentTime.getDay()) % 7)
        );
        nextTuesdayMidnight.setHours(0, 0, 0, 0);

        //console.log("CUrr week", nextWednesdayMidnight);

        // Check if it's before Wednesday
        // if (
        //   currentTime < currentWednesdayMidnight
        //     ? currentTime < currentWednesdayMidnight
        //     : currentTime < nextWednesdayMidnight
        // ) {

        if (nflState.display_week !== nflState.week) {
          //console.log("if");
          const previewMapData = await getMatchupMap(id, week + 1);
          updateDbStorage(matchupObj, previewMapData.updatedScheduleData);
          console.log(currentTime < currentWednesdayMidnight);
        } else {
          //console.log("else");
          const matchupMapDataCopy = await getMatchupMap(id, week - 1);

          const matchupObj = mapToObject(matchupMapDataCopy.matchupMap);
          updateDbStorage(matchupObj, matchupMapData.updatedScheduleData);
        }

        //setting each matchup into Map with key being matchup_id and value being two teams with corresponding matchup_id
      } catch (error) {
        console.error("Error fetching matchup data:", error);
      }
    }

    fetchMatchupData();
  }, [
    typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("selectedLeagueID"),
    leagueID,
  ]);

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

        // console.log("Got it");
        setPlayersData(playersData);

        // Process and use the data as needed
        //console.log("WHO, ", playersData["4017"]);
        // Additional code that uses playersData goes here
      } catch (error) {
        console.error("Error while fetching players data:", error);
      }
    };

    fetchData();
  }, [REACT_APP_LEAGUE_ID]);

  useEffect(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      if (localStorage.getItem("usernameSubmitted") === "false") {
        localStorage.removeItem("selectedLeagueID");
        localStorage.removeItem("selectedLeagueName");
        localStorage.removeItem("usernameSubmitted");
        localStorage.removeItem("progressValue");
        router.refresh();
      }
    } else {
      //console.log("error with local storage");
      // Handle the situation where localStorage is not available
      // You can log an error, use alternative storage methods, or perform other actions
    }
  }, [router]);

  const weekString = week?.toString();
  //console.log("matchupmap", matchupMap);
  // MATCHUP TEXT

  const matchupText = Array.from(matchupMap).map(([matchupID, matchupData]) => {
    const team1 = matchupData[0];
    const team2 = matchupData[1];

    let team1Proj = 0.0;
    let team2Proj = 0.0;

    if (playersData) {
      if (team1?.starters) {
        for (const currPlayer of team1.starters) {
          if (playersData[currPlayer]) {
            const playerData = playersData && playersData[currPlayer];
            if (
              playerData &&
              playerData.wi &&
              weekString !== undefined && // Check if weekString is defined
              typeof weekString === "string" && // Check if weekString is a string
              playerData.wi[weekString] &&
              playerData.wi[weekString]?.p !== undefined
            ) {
              if (playerData.wi[weekString].p)
                team1Proj += parseFloat(playerData.wi[weekString].p || "0");
            }
          }
        }
      }

      if (team2?.starters) {
        for (const currPlayer of team2.starters) {
          if (playersData[currPlayer]) {
            const playerData = playersData && playersData[currPlayer];
            if (
              playerData &&
              playerData.wi &&
              weekString !== undefined && // Check if weekString is defined
              typeof weekString === "string" && // Check if weekString is a string
              playerData.wi[weekString] &&
              playerData.wi[weekString]?.p !== undefined
            ) {
              team2Proj += parseFloat(playerData.wi[weekString].p || "0");
            }
          }
        }
      }
    }

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

    let preGame;
    let liveGame;
    let postGame;

    //check if we're in current week. If we are, display poll. Else, display over/under.
    if (
      parseFloat(team1.team_points) === 0 &&
      parseFloat(team2.team_points) === 0
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
      team1Played &&
      team2Played &&
      (morningSlateEnd || afternoonSlateEnd || snfEnd || mnfEnd)
    ) {
      postGame = true;
      preGame = false;
      liveGame = false;
    }

    const overUnderText = (
      <div>
        <p className="w-[9vw] text-center text-[9px]">
          O/U: {Math.round(team1Proj + team2Proj)}
        </p>
        <p className="w-[9vw] text-center text-[9px] text-[grey]">
          {Math.round(team1Proj) === Math.round(team2Proj)
            ? "EVEN"
            : team1Proj > team2Proj
            ? team1?.name + " -" + Math.round(team1Proj - team2Proj)
            : team2?.name + " -" + Math.round(team2Proj - team1Proj)}
        </p>
      </div>
    );

    const finalText = (
      <p className="text-center self-center text-[9px] ">FINAL</p>
    );

    const liveText = (
      <p className=" animate-pulse text-[9px] font-bold  w-min self-center pr-2 rounded-lg text-[#af1222] flex items-center justify-center ">
        <BsDot className="" size={20} /> LIVE
      </p>
    );

    //console.log("fssd", team1);

    return (
      <div
        key={matchupID}
        className={
          typeof window !== "undefined" &&
          typeof localStorage !== "undefined" &&
          localStorage.getItem("selectedLeagueID")
            ? `hidden xl:flex xl:flex-wrap  justify-center mb-2 text-[9px] font-bold xl:h-[13vh] xl:w-[10vw] hover:bg-[#c4bfbf] dark:hover:bg-[#1a1a1c] cursor-pointer hover:scale-105 hover:duration-200`
            : `hidden`
        }
      >
        {/* need to navigate to schedule page THEN smooth scroll to appropriate matchup */}
        <SmoothLink
          activeClass="active"
          spy={true}
          delay={100}
          smooth={true}
          offset={50}
          duration={700}
          onClick={() => {
            router.push(`/league/${leagueID}/schedule`);
          }}
          to={matchupID}
        >
          <div className="border-r dark:border-[#1a1a1a] border-[#af1222] border-opacity-10 p-2 rounded-md flex flex-col items-start justify-center h-[13vh] w-[10vw]">
            <div
              className={
                team2.team_points > team1.team_points && (postGame || mnfEnd)
                  ? `team1 flex justify-between items-center  w-[9vw] mb-1 text-[#adaeaf]`
                  : `team1 flex justify-between items-center  w-[9vw] mb-1 `
              }
            >
              <span className="flex items-center">
                <Image
                  src={team1.avatar}
                  alt="avatar"
                  height={28}
                  width={28}
                  className="rounded-full mr-1"
                />
                <p>
                  {team1.name.length >= 9
                    ? (team1.name.match(/[A-Z]/g) || []).length > 3
                      ? team1.name.slice(0, 10).toLowerCase()
                      : team1.name.slice(0, 10)
                    : team1.name}
                </p>
              </span>
              <p>
                {parseFloat(team1.team_points || "0") > 0 ||
                parseFloat(team2.team_points || "0") > 0 ? (
                  <AnimatedNumber
                    value={parseFloat(team1.team_points || "0")}
                  />
                ) : team1.user_id &&
                    scheduleDataFinal[team1.user_id]?.wins !== undefined &&
                    scheduleDataFinal[team1.user_id]?.losses !== undefined
                  ? `${scheduleDataFinal[team1.user_id]?.wins} - ${
                      scheduleDataFinal[team1.user_id]?.losses
                    }`
                  : "N/A"}
              </p>
            </div>
            <div
              className={
                team1.team_points > team2.team_points && (postGame || mnfEnd)
                  ? `team2 flex justify-between items-center w-[9vw] text-[#adaeaf]`
                  : `team2 flex justify-between items-center w-[9vw] `
              }
            >
              <span className="flex items-center">
                <Image
                  src={team2.avatar}
                  alt="avatar"
                  height={28}
                  width={28}
                  className="rounded-full mr-1"
                />
                <p>
                  {team2.name.length >= 9
                    ? (team2.name.match(/[A-Z]/g) || []).length > 3
                      ? team2.name.slice(0, 10).toLowerCase()
                      : team2.name.slice(0, 10)
                    : team2.name}
                </p>
              </span>
              <p>
                {parseFloat(team1.team_points || "0") > 0 ||
                parseFloat(team2.team_points || "0") > 0 ? (
                  <AnimatedNumber
                    value={parseFloat(team2.team_points || "0")}
                  />
                ) : team2.user_id &&
                    scheduleDataFinal[team2.user_id]?.wins !== undefined &&
                    scheduleDataFinal[team2.user_id]?.losses !== undefined
                  ? `${scheduleDataFinal[team2.user_id]?.wins} - ${
                      scheduleDataFinal[team2.user_id]?.losses
                    }`
                  : "N/A"}
              </p>
            </div>
            {preGame
              ? overUnderText
              : liveGame && !mnfEnd
              ? liveText
              : postGame || mnfEnd
              ? finalText
              : ""}
          </div>
        </SmoothLink>
      </div>
    );
  });

  return <>{matchupText}</>;
}
