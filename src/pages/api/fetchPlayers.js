// Import necessary modules
import axios from "axios";
import fetch from "node-fetch";
import { MongoClient, ServerApiVersion } from "mongodb";

// Get MongoDB password from environment variables
const password = process.env.MONGO_PASSWORD || "kabofahad123";
const uri = `mongodb+srv://fantasypulseff:${"kabofahad123"}@fantasypulsecluster.wj4o9kr.mongodb.net/?retryWrites=true&w=majority`;

let client;
let clientPromise;

// Initialize MongoDB client
if (!client) {
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  clientPromise = client.connect();
}

// Round function for numbers
const round = (num) => {
  if (typeof num === "string") {
    num = parseFloat(num);
  }
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
};

// Wait for all promises to resolve
async function waitForAll(...ps) {
  const promises = ps.map((p) => (p instanceof Response ? p.json() : p));
  return Promise.all(promises);
}

let players = new Map();
let processedPlayers;

// Function to get data from Sleeper API
function GET(leagueID) {
  console.log("Called server");

  return axios
    .get("https://api.sleeper.app/v1/state/nfl")
    .catch((err) => {
      console.error("Error fetching NFL state:", err);
      throw err;
    })
    .then((nflStateRes) => {
      return axios
        .get(`https://api.sleeper.app/v1/league/${leagueID}`)
        .catch((err) => {
          console.error("Error fetching league data:", err);
          throw err;
        })
        .then((leagueDataRes) => {
          return axios
            .get(
              `https://api.sleeper.app/v1/league/${leagueID}/winners_bracket`
            )
            .catch((err) => {
              console.error("Error fetching playoffs data:", err);
              throw err;
            })
            .then((playoffsRes) => {
              const nflState = nflStateRes.data;
              const leagueData = leagueDataRes.data;
              const playoffs = playoffsRes.data;

              console.log("Here's the state of the nfl: ", nflState);
              let year = nflState.league_season;
              const regularSeasonLength =
                leagueData.settings.playoff_week_start - 1;
              const playoffLength = playoffs.pop().r;
              const fullSeasonLength = regularSeasonLength + playoffLength;

              const resPromises = [
                fetch("https://api.sleeper.app/v1/players/nfl"),
              ];

              resPromises.push(
                fetch(
                  `https://api.sleeper.app/projections/nfl/${year}/?season_type=regular&position[]=DB&position[]=DEF&position[]=DL&position[]=FLEX&position[]=IDP_FLEX&position[]=K&position[]=LB&position[]=QB&position[]=RB&position[]=REC_FLEX&position[]=SUPER_FLEX&position[]=TE&position[]=WR&position[]=WRRB_FLEX&order_by=ppr`
                )
              );

              for (let week = 1; week <= fullSeasonLength + 3; week++) {
                resPromises.push(
                  fetch(
                    `https://api.sleeper.app/projections/nfl/${year}/${week}?season_type=regular&position[]=DB&position[]=DEF&position[]=DL&position[]=FLEX&position[]=IDP_FLEX&position[]=K&position[]=LB&position[]=QB&position[]=RB&position[]=REC_FLEX&position[]=SUPER_FLEX&position[]=TE&position[]=WR&position[]=WRRB_FLEX&order_by=ppr`
                  )
                );
              }

              return waitForAll(...resPromises).then((responses) => {
                const resJSONs = responses.map((res) => {
                  if (!res.ok) {
                    console.error("Error in response:", res);
                    throw new Error("Failed to fetch data from Sleeper API");
                  }
                  return res.json();
                });

                return waitForAll(...resJSONs).then((weeklyData) => {
                  const playerStats = weeklyData[1];
                  const playerData = weeklyData.shift();

                  const scoringSettings = leagueData.scoring_settings;
                  console.log("Format ,", leagueData.type);

                  processedPlayers = computePlayers(
                    playerData,
                    weeklyData,
                    playerStats,
                    scoringSettings,
                    nflState
                  );

                  const filteredPlayers = {};
                  for (const playerId in processedPlayers) {
                    const player = processedPlayers[playerId];
                    if (
                      (player.pos === "QB" ||
                        player.pos === "WR" ||
                        player.pos === "RB" ||
                        player.pos === "TE" ||
                        player.pos === "K" ||
                        player.pos === "DEF") &&
                      player.t
                    ) {
                      filteredPlayers[playerId] = player;
                    }
                  }

                  const playerMap = new Map(Object.entries(filteredPlayers));

                  players = playerMap;

                  return filteredPlayers;
                });
              });
            });
        });
    });
}

// Function to compute players' data
function computePlayers(
  playerData,
  weeklyData,
  playerStats,
  scoringSettings,
  nflState
) {
  const computedPlayers = {};

  const playerStatsArray = Array.isArray(playerStats)
    ? playerStats
    : Object.values(playerStats);

  const playerIndex = playerStatsArray.reduce((index, player) => {
    index[player.player_id] = player;
    return index;
  }, {});

  for (const id in playerData) {
    const projPlayer = playerData[id];
    const player = {
      fn: projPlayer.first_name,
      ln: projPlayer.last_name,
      pos: projPlayer.position,
      t: projPlayer.team ? projPlayer.team : "",
      wi: projPlayer.team ? {} : "",
      adp: "",
      is:
        projPlayer.team && projPlayer.injury_status
          ? projPlayer.injury_status
          : "",
    };
    if (projPlayer.team) {
      player.t = projPlayer.team;
      player.wi = {};
    }
    if (projPlayer.team && projPlayer.injury_status) {
      player.is = projPlayer.injury_status;
    }
    computedPlayers[id] = player;
  }

  for (let week = 1; week <= weeklyData.length; week++) {
    for (const player of weeklyData[week - 1]) {
      const id = player.player_id;
      computedPlayers[id].adp = playerIndex[id]?.stats || {};
      if (!computedPlayers[id].wi) continue;
      if (nflState.season_type == "off") {
        computedPlayers[id].wi[week - 1] = {
          p: calculateProjection(player.stats, scoringSettings),
          o: player.opponent,
        };
      } else {
        computedPlayers[id].wi[week - 1] = {
          p: calculateProjection(player.stats, scoringSettings),
          o: player.opponent,
        };
      }
    }
  }

  computedPlayers["OAK"] = computedPlayers["LV"];
  return computedPlayers;
}

// Function to calculate projection
const calculateProjection = (projectedStats, scoreSettings) => {
  let score = 0;
  for (const stat in projectedStats) {
    const multiplier = scoreSettings[stat] ? scoreSettings[stat] : 0;
    score += projectedStats[stat] * multiplier;
  }
  return round(score);
};

export default async function handler(req, res) {
  try {
    await clientPromise; // Ensure the client is connected
    // Access the database and collection
    const db = client.db("fantasypulse");
    const collection = db.collection("players");

    const playerArrayId = "week 1";

    const filter = { id: playerArrayId };

    const lastUpdate = await collection.findOne({ id: "lastUpdate" });
    const now = new Date();
    const lastUpdateDate = lastUpdate ? new Date(lastUpdate.date) : new Date(0);
    // Was "same calendar day" - real roster moves (a waiver claim, a
    // practice-squad call-up, a late free-agent signing) happen all day
    // long during the season, and a player added at 10am used to be
    // invisible everywhere in the app - Rankings, Start/Sit, Trade
    // Calculator, all of it - until midnight. Verified live: two real,
    // currently-active players (John FitzPatrick, Treyvhon Saunders) were
    // missing from this endpoint's own output because of exactly this.
    // A few hours keeps the same "don't hit Sleeper on every request"
    // point of this cache without letting a real roster move sit stale
    // for up to a day.
    const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
    const isFresh = now.getTime() - lastUpdateDate.getTime() < CACHE_TTL_MS;

    if (isFresh) {
      const existingDocument = await collection.findOne(filter);
      res.status(200).json(existingDocument.players);
    } else {
      const processedPlayers = await GET(req.body.leagueId);

      const playerArray = { id: playerArrayId, players: processedPlayers };

      const updateOperation = {
        $set: playerArray,
      };

      const result = await collection.updateOne(filter, updateOperation, {
        upsert: true,
      });

      if (result.upsertedCount === 1) {
        console.log("Document inserted.");
      } else if (result.matchedCount === 1) {
        console.log("Document updated.");
      } else {
        console.log("No document inserted or updated.");
      }

      await collection.updateOne(
        { id: "lastUpdate" },
        { $set: { date: now.toISOString() } },
        { upsert: true }
      );

      return res.status(200).json(processedPlayers);
    }
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
