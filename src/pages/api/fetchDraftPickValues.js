// pages/api/fetchDraftPickValues.js
//
// Bulk read of the playersValues collection's draft-pick rows (the
// webcrawler pulls these from KTC's rankings alongside real players - same
// collection, `Position: "RDP"`, e.g. "2027 Early 1st"). Sleeper ID is
// always null for these (they're not real players), so the existing
// fetchAllPlayerValues route - which filters on `Sleeper ID != null` and
// keys its result by Sleeper ID - can't serve them. Keyed here by a
// normalized name instead: lowercased, spaces stripped, matching
// mobile/lib/draftPicks.ts's normalizePickKey so a pick built from real
// league data can look its KTC value straight up.
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

function normalizeKey(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const client = await connectToDatabase();
    const db = client.db("fantasypulse");
    const collection = db.collection("playersValues");

    const picks = await collection
      .find(
        { Position: "RDP" },
        {
          projection: {
            _id: 0,
            "Player Name": 1,
            Value: 1,
            RdrftValue: 1,
            SFValue: 1,
            SFRdrftValue: 1,
          },
        }
      )
      .toArray();

    const valuesByKey = {};
    for (const pick of picks) {
      valuesByKey[normalizeKey(pick["Player Name"])] = pick;
    }

    return res.status(200).json(valuesByKey);
  } catch (error) {
    console.error("Error fetching draft pick values:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
