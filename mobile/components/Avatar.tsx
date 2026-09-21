import { View, Text, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BOOGIE_UID } from "../lib/posts";

const boogieImg = require("../assets/images/boogie.png");

// One avatar renderer for every place a user's picture shows up (posts,
// profile headers, compose boxes): a real photo when there is one, Boogie's
// real staff-writer photo for auto-announced posts, and a colored initial
// circle as the fallback everywhere else - so nothing crashes or shows a
// broken image just because a manager hasn't set a picture yet.

interface AvatarProps {
  uid?: string;
  url?: string | null;
  name: string;
  size?: number;
}

export default function Avatar({ uid, url, name, size = 42 }: AvatarProps) {
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
