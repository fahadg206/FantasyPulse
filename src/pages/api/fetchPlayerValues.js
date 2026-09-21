// pages/api/fetchPlayerValues.js
import { MongoClient } from "mongodb";
import { computeAdjustedValue } from "@/lib/playerValue";

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
    tlsAllowInvalidCertificates: true, // This line disables SSL validation
  });

  await client.connect();
  cachedClient = client;
  return client;
}

// Sane fallback if the caller doesn't pass league settings (defaults to the
// old behaviour: dynasty 1QB, standard PPR, 4pt passing TDs, no TE premium).
const DEFAULT_LEAGUE_SETTINGS = {
  isDynasty: true,
  isSuperflex: false,
  tePremium: 0,
  pprValue: 1,
  passingTdPoints: 4,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sleeperId, leagueSettings, scoringType } = req.body;

  if (!sleeperId) {
    return res.status(400).json({ message: "Sleeper ID is required" });
  }

  // Back-compat: older callers may still send a `scoringType` string instead
  // of a full leagueSettings object.
  const settings = leagueSettings || {
    ...DEFAULT_LEAGUE_SETTINGS,
    isDynasty:
      typeof scoringType === "string"
        ? scoringType.includes("dynasty")
        : DEFAULT_LEAGUE_SETTINGS.isDynasty,
  };

  try {
    const client = await connectToDatabase();
    const db = client.db("fantasypulse");
    const collection = db.collection("playersValues");

    const player = await collection.findOne({ "Sleeper ID": sleeperId });

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const value = computeAdjustedValue(player, settings);

    return res.status(200).json({ value });
  } catch (error) {
    console.error("Error fetching player value:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
