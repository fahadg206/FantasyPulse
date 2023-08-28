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
  fname?: string;
  lname?: string;
  avatar?: string;
  scored_points?: string;
  projected_points?: string;
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
  const [scheduleDataFinal, setScheduleDataFinal] = useState<ScheduleData>({});
  const [playersData, setPlayersData] =
    React.useState<Record<string, PlayerData>>();
  const [week, setWeek] = useState<number>();

  const weeklyInfo: WeeklyInformation = {};

  const [matchupMap, setMatchupMap] = useState<Map<string, MatchupMapData[]>>(
    new Map()
  );
  const REACT_APP_LEAGUE_ID: string | null =
    localStorage.getItem("selectedLeagueID");

  const router = useRouter();

  const { isSundayAfternoon, isSundayEvening, isSundayNight, isMondayNight } =
    useTimeChecks();

  useEffect(() => {
    setMnfEnd(isMondayNight);
    setSnfEnd(isSundayNight);
    setAfternoonSlateEnd(isSundayEvening);
    setMorningSlateEnd(isSundayAfternoon);
  }, [isMondayNight, isSundayNight, isSundayEvening, isSundayAfternoon]);

  function updateDbStorage(weeklyData: ScheduleData) {
    if (REACT_APP_LEAGUE_ID) {
      const storageRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}.txt`);

      //Uncomment to upload textfile to firebase storage

      const articleMatchupData: ScheduleData = JSON.parse(
        JSON.stringify(weeklyData)
      );

      for (const matchupId in articleMatchupData) {
        const matchup = articleMatchupData[matchupId];

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
          }
        }
      }

      //console.log("data ", articleMatchupData);

      const textContent = JSON.stringify(articleMatchupData);

      const readingRef = ref(storage, `files/${REACT_APP_LEAGUE_ID}.txt`);
      // Function to add content only if it's different
      addContentIfDifferent(textContent, storageRef);

      // // Upload the text content as a text file to Firebase Cloud Storage
      // uploadString(storageRef, textContent, "raw")
      //   .then(() => {
      //     console.log("Text file uploaded to Firebase Cloud Storage.");
      //   })
      //   .catch((error) => {
      //     console.error("Error uploading text file:", error);
      //   });
      // const readingRef = ref(storage, `files/`);
      // try {
      //   getDownloadURL(readingRef)
      //     .then((url) => {
      //       fetch(url)
      //         .then((response) => response.text())
      //         .then((fileContent) => {
      //           console.log(
      //             "Text file content from Firebase Cloud Storage:",
      //             fileContent
      //           );
      //         })
      //         .catch((error) => {
      //           console.error("Error fetching text file content:", url);
      //         });
      //     })
      //     .catch((error) => {
      //       console.error("Error getting download URL:", error);
      //     });
      // } catch (error) {
      //   console.error("Unexpected error:", error);
      // }
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
            if (!existingContent || existingContent !== newContent) {
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
          console.error("Error getting download URL:", error);
        }
      });
  }

  // Function to upload new content
  function uploadNewContent(content: any, storageRef: any) {
    uploadString(storageRef, content, "raw")
      .then(() => {
        console.log("Text file uploaded to Firebase Cloud Storage.");
      })
      .catch((error) => {
        console.error("Error uploading text file:", error);
      });
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
        const matchupMapData = await getMatchupMap(REACT_APP_LEAGUE_ID, week);
        setMatchupMap(matchupMapData.matchupMap);
        setScheduleDataFinal(matchupMapData.updatedScheduleData);

        updateDbStorage(matchupMapData.updatedScheduleData);
        //setting each matchup into Map with key being matchup_id and value being two teams with corresponding matchup_id
      } catch (error) {
        console.error("Error fetching matchup data:", error);
      }
    }

    fetchMatchupData();
  }, [REACT_APP_LEAGUE_ID]);

  useEffect(() => {
    axios
      .get("http://localhost:3001/api/players")
      .then((response) => {
        const playersData = response.data;

        setPlayersData(playersData);
        // Process and use the data as needed
      })
      .catch((error) => {
        console.error("Error while fetching players data:", error);
      });
  }, []);

  if (localStorage.getItem("usernameSubmitted") === "false") {
    localStorage.removeItem("selectedLeagueID");
    localStorage.removeItem("selectedLeagueName");
    localStorage.removeItem("usernameSubmitted");
    router.refresh();
  }

  const weekString = week?.toString();

  // MATCHUP TEXT

  const matchupText = Array.from(matchupMap).map(([matchupID, matchupData]) => {
    const team1 = matchupData[0];
    const team2 = matchupData[1];

    let team1Proj = 0.0;
    let team2Proj = 0.0;

    if (team1?.starters) {
      for (const currPlayer of team1.starters) {
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

    if (team2?.starters) {
      for (const currPlayer of team2.starters) {
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
          {team1Proj > team2Proj
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

    return (
      <div
        key={matchupID}
        className={
          !localStorage.getItem("selectedLeagueID")
            ? `hidden`
            : `hidden xl:flex flex-wrap  justify-center mb-2 text-[9px] font-bold xl:h-[13vh] xl:w-[10vw] hover:bg-[#c4bfbf] dark:hover:bg-[#1a1a1c] cursor-pointer hover:scale-105 hover:duration-200`
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
            router.push(
              `/league/${localStorage.getItem("selectedLeagueID")}/schedule`
            );
          }}
          to={matchupID}
        >
          <div className="border-r dark:border-[#1a1a1a] border-[#af1222] border-opacity-10 p-2 rounded-md flex flex-col items-start justify-center h-[13vh] w-[10vw]">
            <div
              className={
                team2.team_points > team1.team_points
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
                parseFloat(team2.team_points || "0") > 0
                  ? team1.team_points
                  : team1.user_id &&
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
                team1.team_points > team2.team_points
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
                parseFloat(team2.team_points || "0") > 0
                  ? team2.team_points
                  : team2.user_id &&
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
              : liveGame
              ? liveText
              : postGame
              ? finalText
              : ""}
          </div>
        </SmoothLink>
      </div>
    );
  });

  return matchupText;
}
