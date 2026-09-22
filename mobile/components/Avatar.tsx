import { View, Text, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BOOGIE_UID } from "../lib/posts";

const boogieImg = require("../assets/images/boogie.png");
const helmetImg = require("../assets/images/helmet2.png");

// One avatar renderer for every place a picture shows up (posts, profile
// headers, compose boxes, league rows): a real photo when there is one,
// Boogie's real staff-writer photo for auto-announced posts, the Fantasy
// Pulse helmet for a league with no picture of its own, and a colored
// initial circle as the fallback for a user with no picture - so nothing
// crashes or shows a broken image just because something hasn't set one.

interface AvatarProps {
  uid?: string;
  url?: string | null;
  name: string;
  size?: number;
  /** "league" swaps the no-picture fallback from an initial circle to the Fantasy Pulse helmet */
  kind?: "user" | "league";
}

export default function Avatar({ uid, url, name, size = 42, kind = "user" }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (uid === BOOGIE_UID) {
    return (
      <View style={[dimension, { overflow: "hidden" }]} className="bg-brand/20">
        <Image source={boogieImg} style={dimension} resizeMode="cover" />
      </View>
    );
  }

  if (url) {
    return <Image source={{ uri: url }} style={dimension} className="bg-white/10" resizeMode="cover" />;
  }

  if (kind === "league") {
    return (
      <View style={[dimension, { overflow: "hidden" }]} className="bg-brand/10 items-center justify-center">
        <Image source={helmetImg} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" />
      </View>
    );
  }

  return (
    <View style={dimension} className="bg-brand/20 items-center justify-center">
      {name ? (
        <Text style={{ fontSize: size * 0.38 }} className="text-brand font-bold">
          {name.charAt(0).toUpperCase()}
        </Text>
      ) : (
        <Feather name="user" size={size * 0.45} color="#af1222" />
      )}
    </View>
  );
}
