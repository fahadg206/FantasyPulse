// pages/api/fetchAllPlayerValues.js
//
// Bulk read of the playersValues collection (populated by
// scripts/player-value-crawler) keyed by Sleeper ID, for pages that need
// to look up many players' values at once - e.g. power rankings computing
// a whole roster's value - instead of one request per player.
import { MongoClient } from "mongodb";

const password = process.env.MONGO_PASSWORD || "kabofahad123";
const uri = `mongodb+srv://fantasypulseff:${password}@fantasypulsecluster.wj4o9kr.mongodb.net/?retryWrites=true&w=majority`;

let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) {
    return cachedClient;
  }

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    tlsAllowInvalidCertificates: true,
  });

  await client.connect();
  cachedClient = client;
  return client;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const client = await connectToDatabase();
    const db = client.db("fantasypulse");
    const collection = db.collection("playersValues");

    const players = await collection
      .find(
        { "Sleeper ID": { $ne: null } },
        {
          projection: {
            _id: 0,
            "Sleeper ID": 1,
            "Player Name": 1,
            Position: 1,
            Value: 1,
            RdrftValue: 1,
            SFValue: 1,
            SFRdrftValue: 1,
          },
        }
      )
      .toArray();

    // keyed by Sleeper ID so callers can look players up in O(1)
    const valuesBySleeperId = {};
    for (const player of players) {
      valuesBySleeperId[player["Sleeper ID"]] = player;
    }

    return res.status(200).json(valuesBySleeperId);
  } catch (error) {
    console.error("Error fetching all player values:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
