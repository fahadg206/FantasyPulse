"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@nextui-org/react";
import { Button } from "@nextui-org/react";
import Image from "next/image";
import { FaSearch, FaPlus, FaTrash, FaStar } from "react-icons/fa";
import logo from "../../../images/helmet2.png";
import { useRouter } from "next/navigation";
import {
  getLeagueValueSettings,
  LeagueValueSettings,
} from "@/lib/playerValue";

const teamColors: { [key: string]: string } = {
  BAL: "#241773",
  ATL: "#000000",
  DEN: "#FB4F14",
  HOU: "#03202F",
  NO: "#D3BC8D",
  CLE: "#311D00",
  CIN: "#FB4E14",
  WAS: "#5A1414",
  LV: "#A6ACAF",
  PIT: "#000000",
  DAL: "#002244",
  SEA: "#69BE28",
  SF: "#B3995D",
  ARI: "#972240",
  LAR: "#003594",
  TB: "#D50A0A",
  CAR: "#0085CA",
  GB: "#FFB612",
  DET: "#0076B6",
  MIN: "#4F2683",
  CHI: "#0B162A",
  BUF: "#00338D",
  NE: "#002244",
  MIA: "#008E97",
  IND: "#002C5F",
  JAC: "#006778",
  TEN: "#002244",
  NYJ: "#125740",
  NYG: "#0B2265",
  PHI: "#004C54",
  KC: "#E31837",
  LAC: "#002244",
  FA: "",
};

const getPositionColor = (position: string): string => {
  switch (position) {
    case "QB":
      return "text-red-500";
    case "WR":
      return "text-blue-500";
    case "RB":
      return "text-green-500";
    case "TE":
      return "text-yellow-500";
    default:
      return "text-gray-600";
  }
};

interface User {
  managerID: string;
  userName: string;
  avatar: string;
}

interface Player {
  id: string;
  fn: string;
  ln: string;
  pos: string;
  t: string;
  value: number;
}

const TradeCalculator: React.FC = () => {
  const [selected, setSelected] = useState<string>("Select Team");
  const [selected2, setSelected2] = useState<string>("Select Team");
  const [users, setUsers] = useState<User[]>([]);
  const [playersData, setPlayersData] = useState<{ [key: string]: Player }>({});
  const [team1Players, setTeam1Players] = useState<string[]>([]);
  const [team2Players, setTeam2Players] = useState<string[]>([]);
  const [team1Trade, setTeam1Trade] = useState<Player[]>([]);
  const [team2Trade, setTeam2Trade] = useState<Player[]>([]);
  const [tradeStatus, setTradeStatus] = useState<
    { text: string; color: string } | string
  >("");
  const [team1Total, setTeam1Total] = useState<number>(0);
  const [team2Total, setTeam2Total] = useState<number>(0);
  const [valueAdjustmentSide, setValueAdjustmentSide] = useState<number>(0);
  const [valueToEvenTrade, setValueToEvenTrade] = useState<number>(0);
  const acceptanceBufferAmount = 1000;
  const [leagueSettings, setLeagueSettings] =
    useState<LeagueValueSettings | null>(null);

  const REACT_APP_LEAGUE_ID = localStorage.getItem("selectedLeagueID");

  const router = useRouter();

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
    fetchUsers();
    fetchPlayersData();
    fetchLeagueSettings();
  }, []);

  useEffect(() => {
    if (selected !== "Select Team" && selected2 !== "Select Team") {
      fetchTeamsData();
    }
  }, [selected, selected2]);

  useEffect(() => {
    calculateTradeStatus();
  }, [team1Trade, team2Trade]);

  // Pulls the league's actual format (dynasty/redraft, superflex) and
  // scoring settings (TE premium, PPR level, passing TD points) straight
  // from Sleeper so player values reflect this specific league instead of a
  // generic default.
  const fetchLeagueSettings = async () => {
    try {
      const settings = await getLeagueValueSettings(
        REACT_APP_LEAGUE_ID as string
      );
      setLeagueSettings(settings);
    } catch (error) {
      console.error("Error fetching league settings:", error);
    }
  };

  const fetchUsers = async () => {
    try {
      const usersResponse = await axios.get(
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/users`
      );
      const usersData = processUsers(usersResponse.data);
      setUsers(usersData);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchPlayersData = async () => {
    try {
      const playersResponse = await fetch("/api/fetchPlayers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ leagueId: REACT_APP_LEAGUE_ID }),
      });
      const data = await playersResponse.json();
      setPlayersData(data);
    } catch (error) {
      console.error("Error fetching players data:", error);
    }
  };

  const fetchTeamsData = async () => {
    try {
      const rostersResponse = await axios.get(
        `https://api.sleeper.app/v1/league/${REACT_APP_LEAGUE_ID}/rosters`
      );
      const rosters = rostersResponse.data;

      const team1 = rosters.find((roster: any) => roster.owner_id === selected);
      const team2 = rosters.find(
        (roster: any) => roster.owner_id === selected2
      );

      if (team1) {
        setTeam1Players(team1.players);
      }
      if (team2) {
        setTeam2Players(team2.players);
      }
    } catch (error) {
      console.error("Error fetching team data:", error);
    }
  };

  const handleSelectionChange = (selection: any) => {
    if (selection.currentKey !== selected2) {
      setSelected(selection.currentKey);
      setTeam1Trade([]);
      setTeam2Trade([]);
    }
  };

  const handleSelectionChange2 = (selection: any) => {
    if (selection.currentKey !== selected) {
      setSelected2(selection.currentKey);
      setTeam1Trade([]);
      setTeam2Trade([]);
    }
  };

  const processUsers = (rawUsers: any[]): User[] => {
    return rawUsers.map((user) => ({
      managerID: user.user_id,
      userName: user.display_name,
      avatar: user.avatar
        ? `https://sleepercdn.com/avatars/${user.avatar}`
        : "",
    }));
  };

  const fetchPlayerValue = async (
    sleeperId: string
  ): Promise<number | null> => {
    try {
      const response = await fetch("/api/fetchPlayerValues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sleeperId, leagueSettings }),
      });
      const data = await response.json();
      return data.value;
    } catch (error) {
      console.error("Error fetching player value:", error);
      return null;
    }
  };

  const handlePlayerClick = async (team: number, playerId: string) => {
    const player = playersData[playerId];
    if (!player) return;

    const playerValue = (await fetchPlayerValue(playerId)) || 500;
    const playerWithId = { ...player, id: playerId, value: playerValue };

    if (team === 1) {
      setTeam1Trade([...team1Trade, playerWithId]);
      setTeam1Players(team1Players.filter((id) => id !== playerId));
    } else {
      setTeam2Trade([...team2Trade, playerWithId]);
      setTeam2Players(team2Players.filter((id) => id !== playerId));
    }
  };

  const handlePlayerRemove = (team: number, playerId: string) => {
    if (team === 1) {
      const removedPlayer = team1Trade.find((player) => player.id === playerId);
      if (removedPlayer) {
        setTeam1Trade(team1Trade.filter((player) => player.id !== playerId));
        setTeam1Players([...team1Players, removedPlayer.id]);
      }
    } else {
      const removedPlayer = team2Trade.find((player) => player.id === playerId);
      if (removedPlayer) {
        setTeam2Trade(team2Trade.filter((player) => player.id !== playerId));
        setTeam2Players([...team2Players, removedPlayer.id]);
      }
    }
  };

  const clearTrade = (team: number) => {
    if (team === 1) {
      setTeam1Players([
        ...team1Players,
        ...team1Trade.map((player) => player.id),
      ]);
      setTeam1Trade([]);
    } else {
      setTeam2Players([
        ...team2Players,
        ...team2Trade.map((player) => player.id),
      ]);
      setTeam2Trade([]);
    }
  };

  const getTeamColor = (team: string): string => teamColors[team] || "#333";
  const getTeamLogo = (team: string): string =>
    `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;

  const calculateTradeStatus = () => {
    if (team1Trade.length === 0 && team2Trade.length === 0) {
      setTradeStatus("");
      return;
    }

    const team1TotalValue = team1Trade.reduce(
      (total, player) => total + (player.value || 0),
      0
    );
    const team2TotalValue = team2Trade.reduce(
      (total, player) => total + (player.value || 0),
      0
    );

    setTeam1Total(team1TotalValue);
    setTeam2Total(team2TotalValue);

    const difference = Math.abs(team1TotalValue - team2TotalValue);

    const calculatedValueToEvenTrade =
      valueAdjustmentSide === 1
        ? Math.abs(team1TotalValue + valueAdjustmentSide - team2TotalValue)
        : Math.abs(team2TotalValue + valueAdjustmentSide - team1TotalValue);

    setValueToEvenTrade(calculatedValueToEvenTrade);

    if (calculatedValueToEvenTrade <= acceptanceBufferAmount) {
      setTradeStatus({ text: "Fair trade", color: "text-green-500" });
    } else if (difference <= acceptanceBufferAmount) {
      setTradeStatus({ text: "Almost fair", color: "text-yellow-500" });
    } else if (difference <= acceptanceBufferAmount * 2) {
      setTradeStatus({ text: "Unfair", color: "text-orange-500" });
    } else {
      setTradeStatus({ text: "Highway Robbery", color: "text-red-500" });
    }
  };

  const renderStars = (value: number) => {
    const fullStars = Math.floor(value / 2000);
    const halfStar = value % 2000 >= 1000;
    const quarterStar = value % 1000 >= 500;

    return (
      <div className="flex items-center space-x-1">
        {Array.from({ length: fullStars }, (_, i) => (
          <FaStar key={i} className="text-yellow-500" />
        ))}
        {halfStar && (
          <div className="relative">
            <FaStar className="text-yellow-500 opacity-50" />
            <FaStar
              className="absolute top-0 left-0 text-yellow-500"
              style={{ clipPath: "inset(0 50% 0 0)" }}
            />
          </div>
        )}
        {!halfStar && quarterStar && (
          <div className="relative">
            <FaStar className="text-yellow-500 opacity-50" />
            <FaStar
              className="absolute top-0 left-0 text-yellow-500"
              style={{ clipPath: "inset(0 75% 0 0)" }}
            />
          </div>
        )}
      </div>
    );
  };

  const renderPlayer = (playerId: string, team: number) => {
    const player = playersData[playerId];
    if (!player) return null;

    const teamColor = getTeamColor(player.t);
    const teamLogo = getTeamLogo(player.t);

    return (
      <div
        key={playerId}
        className="relative p-2 rounded-lg cursor-pointer"
        style={{ backgroundColor: teamColor }}
        onClick={() => handlePlayerClick(team, playerId)}
      >
        <div className="absolute inset-0">
          <Image
            src={teamLogo}
            alt={player.team}
            layout="fill"
            objectFit="cover"
            className="opacity-20"
          />
        </div>
        <div className="relative flex items-center space-x-2">
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
            alt={player.fn}
            className="w-10 h-10 rounded-full"
          />
          <div className="text-white space-y-1">
            <h3 className="text-sm font-bold">{player.fn}</h3>
            <p className="text-xs">{player.pos}</p>
            <p className="text-xs">{player.t}</p>
            <div className="flex">{renderStars(player.value)}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeamDropdown = (
    teamPlayers: string[],
    teamName: string,
    team: number
  ) => (
    <Dropdown className="w-full mb-4 lg:mb-0">
      <DropdownTrigger>
        <Button className="w-full">
          <FaPlus className="mr-2" />
          Add a player from {teamName}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={`${teamName} Players`}
        selectionMode="single"
        onSelectionChange={(selection) =>
          handlePlayerClick(team, selection.currentKey)
        }
        className="max-h-48 overflow-y-auto bg-black bg-opacity-80 text-gray-200"
      >
        {teamPlayers.map((playerId) => {
          const player = playersData[playerId];
          if (!player) return null;
          return (
            <DropdownItem key={playerId} value={playerId}>
              <div className="flex items-center space-x-2">
                <img
                  src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
                  alt={player.fn}
                  className="w-8 h-8 rounded-full"
                />
                <Image
                  src={getTeamLogo(player.t)}
                  alt={player.t}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="truncate">
                  {player.fn.charAt(0)}. {player.ln}{" "}
                  <span className={getPositionColor(player.pos)}>
                    {" "}
                    - {player.pos}
                  </span>
                </span>
              </div>
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </Dropdown>
  );

  const renderTrade = (tradePlayers: Player[], team: string) => {
    const user = users.find((u) => u.managerID === team);
    const teamName = user ? user.userName : "";
    const teamAvatar = user ? (user.avatar ? user.avatar : logo) : logo;

    return (
      <div className="w-full lg:w-1/2 bg-[#d1d1d1] dark:bg-[#2a2a2a] p-2 rounded-lg mb-4 lg:mb-0">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center space-x-2">
            <Image
              src={teamAvatar}
              alt={teamName}
              width={60}
              height={60}
              className="rounded-full"
            />
            <div>
              <h2 className="text-lg font-bold">{teamName}</h2>
            </div>
          </div>
          <Button
            className="text-red-500 bg-transparent hover:bg-transparent border-none p-0"
            onClick={() => clearTrade(team === selected ? 1 : 2)}
          >
            Clear
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {tradePlayers.map((player) => (
            <div
              key={player.id}
              className="relative p-2 rounded-lg flex group"
              style={{ backgroundColor: getTeamColor(player.t) }}
            >
              <div className="absolute inset-0 opacity-50 z-10">
                <Image
                  src={getTeamLogo(player.t)}
                  alt={player.team}
                  layout="intrinsic"
                  width={75}
                  height={75}
                  objectFit="contain"
                  className="transform translate-x-6"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-l from-black to-transparent opacity-30 rounded-lg z-20"></div>
              <Image
                src={`https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`}
                alt={player.fn}
                height={40}
                width={80}
                className="h-16 transform translate-y-4 -m-4 z-30"
              />
              <div className="flex flex-col items-end justify-center ml-auto text-right z-40 text-gray-200 space-y-1">
                <h3 className="text-sm font-bold">
                  {player.fn} {player.ln}
                </h3>
                <div className="text-xs">
                  <span>{player.pos} - </span>
                  <span>{player.t}</span>
                </div>
                <div className="flex">{renderStars(player.value)}</div>
              </div>
              <FaTrash
                className="absolute top-1 right-1 text-gray-500 cursor-pointer z-50 opacity-40 hover:opacity-100 transition-opacity duration-200"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayerRemove(team === selected ? 1 : 2, player.id);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTradeScale = () => {
    const total = team1Total + team2Total;
    const team1Percentage = ((team1Total / total) * 100).toFixed(2);
    const team2Percentage = ((team2Total / total) * 100).toFixed(2);

    return (
      <div className="w-full mt-4">
        <div className="flex justify-between items-center mb-2">
          <Image
            src={selectedUser?.avatar ? selectedUser.avatar : logo}
            alt={selectedUser?.userName}
            width={40}
            height={40}
            className="rounded-full"
          />
          <span className="text-xs">{team1Percentage}%</span>
          <TradeBalance
            team1Percentage={parseFloat(team1Percentage)}
            team2Percentage={parseFloat(team2Percentage)}
          />
          <span className="text-xs">{team2Percentage}%</span>
          <Image
            src={selectedUser2?.avatar ? selectedUser2.avatar : logo}
            alt={selectedUser2?.userName}
            width={40}
            height={40}
            className="rounded-full"
          />
        </div>
        <div className="text-center text-lg font-bold mt-2">
          <span className={`${tradeStatus.color}`}>{tradeStatus.text}</span>
        </div>
      </div>
    );
  };

  const selectedUser = users.find((user) => user.managerID === selected);
  const selectedUser2 = users.find((user) => user.managerID === selected2);

  const selectedText = selectedUser ? (
    <div className="flex items-center justify-center bg-[rgb(224,223,223)] dark:bg-[#2a2a2a] border-r border-b dark:border-[#2a2a2a] border-[#af1222] border-[1px] text-[13px] w-[150px] font-bold border-opacity-20 rounded-[8px] p-2">
      <Image
        src={selectedUser.avatar ? selectedUser.avatar : logo}
        alt="avatar"
        width={30}
        height={30}
        className="rounded-full mr-1"
      />
      {selectedUser.userName}
    </div>
  ) : (
    <div className="flex items-center justify-center bg-[rgb(224,223,223)] dark:bg-[#2a2a2a] border-r border-b  border-[#af1222] dark:border-[rgb(224,223,223)] text-center border-[1px] text-[13px] w-[150px] font-bold border-opacity-20 rounded-[8px] p-2">
      Select Team
    </div>
  );

  const selectedText2 = selectedUser2 ? (
    <div className="flex items-center justify-center bg-[rgb(224,223,223)] dark:bg-[#2a2a2a] border-r border-b dark:border-[#2a2a2a] border-[#af1222] border-[1px] text-[13px] w-[150px] font-bold border-opacity-20 rounded-[8px] p-2">
      <Image
        src={selectedUser2.avatar ? selectedUser2.avatar : logo}
        alt="avatar"
        width={30}
        height={30}
        className="rounded-full mr-1"
      />
      {selectedUser2.userName}
    </div>
  ) : (
    <div className="flex items-center justify-center bg-[rgb(224,223,223)] dark:bg-[#2a2a2a] border-r border-b  border-[#af1222] dark:border-[rgb(224,223,223)] text-center border-[1px] text-[13px] w-[150px] font-bold border-opacity-20 rounded-[8px] p-2">
      Select Team
    </div>
  );

  return (
    <div className="md:w-[60vw] min-w-full min-h-screen bg-[#EDEDED] dark:bg-black p-4">
      <div className="bg-[#e0dfdf] dark:bg-[#1a1a1a] rounded-lg shadow-lg">
        <div className="flex flex-col lg:flex-row justify-between items-center p-4 bg-[#d1d1d1] dark:bg-[#2a2a2a] rounded-t-lg">
          <h1 className="text-xl font-bold">Trade Calculator</h1>
          {team1Trade.length > 0 || team2Trade.length > 0 ? (
            <div className={`${tradeStatus.color} text-sm font-semibold`}>
              {tradeStatus.text}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col lg:flex-row p-4 space-y-4 lg:space-y-0 lg:space-x-4">
          <Dropdown className="w-full lg:w-1/2">
            <DropdownTrigger>
              <Button className="w-full ">{selectedText}</Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Teams"
              selectionMode="single"
              selectedKeys={selected}
              onSelectionChange={handleSelectionChange}
              className="max-h-48 overflow-y-auto bg-black bg-opacity-80 text-gray-200"
            >
              {users
                .filter((user) => user.managerID !== selected2)
                .map((user) => (
                  <DropdownItem key={user.managerID} value={user.managerID}>
                    <div className="flex items-center">
                      <Image
                        src={user.avatar ? user.avatar : logo}
                        alt="avatar"
                        width={30}
                        height={30}
                        className="rounded-full mr-1"
                      />
                      {user.userName}
                    </div>
                  </DropdownItem>
                ))}
            </DropdownMenu>
          </Dropdown>
          <Dropdown className="w-full lg:w-1/2">
            <DropdownTrigger>
              <Button className="w-full">{selectedText2}</Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Teams"
              selectionMode="single"
              selectedKeys={selected2}
              onSelectionChange={handleSelectionChange2}
              className="max-h-48 overflow-y-auto bg-black bg-opacity-80 text-gray-200"
            >
              {users
                .filter((user) => user.managerID !== selected)
                .map((user) => (
                  <DropdownItem key={user.managerID} value={user.managerID}>
                    <div className="flex items-center">
                      <Image
                        src={user.avatar ? user.avatar : logo}
                        alt="avatar"
                        width={30}
                        height={30}
                        className="rounded-full mr-1"
                      />
                      {user.userName}
                    </div>
                  </DropdownItem>
                ))}
            </DropdownMenu>
          </Dropdown>
          <Button
            className="w-full lg:w-auto mt-4 lg:mt-0"
            onClick={fetchTeamsData}
          ></Button>
        </div>
        <div
          className={`flex flex-col lg:flex-row p-4 space-y-4 lg:space-y-0 lg:space-x-4 ${
            selected !== "Select Team" && selected2 !== "Select Team"
              ? "w-full"
              : "w-full lg:w-full"
          }`}
        >
          {selected !== "Select Team" && selected2 !== "Select Team" && (
            <>
              {renderTeamDropdown(
                team1Players,
                selectedUser?.userName + "'s team",
                1
              )}
              {renderTeamDropdown(
                team2Players,
                selectedUser2?.userName + "'s team",
                2
              )}
            </>
          )}
        </div>
        {selected !== "Select Team" && selected2 !== "Select Team" && (
          <>
            <div className="flex flex-col lg:flex-row p-4 space-y-4 lg:space-y-0 lg:space-x-4">
              {renderTrade(team1Trade, selected)}
              {renderTrade(team2Trade, selected2)}
            </div>
            {team1Trade.length > 0 || team2Trade.length > 0
              ? renderTradeScale()
              : null}
          </>
        )}
      </div>
    </div>
  );
};

interface TradeBalanceProps {
  team1Percentage: number;
  team2Percentage: number;
}

const TradeBalance: React.FC<TradeBalanceProps> = ({
  team1Percentage,
  team2Percentage,
}) => {
  return (
    <div className="relative w-full h-4 bg-gray-300 rounded-full overflow-hidden">
      <div
        className="absolute top-0 left-0 h-full bg-blue-500 transition-all duration-300"
        style={{ width: `${team1Percentage}%` }}
      ></div>
      <div
        className="absolute top-0 right-0 h-full bg-red-500 transition-all duration-300"
        style={{ width: `${team2Percentage}%` }}
      ></div>
    </div>
  );
};

export default TradeCalculator;
