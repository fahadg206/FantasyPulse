import { useEffect, useState } from "react";
import { Image } from "react-native";

// A post's attached image used to be forced into a fixed 16:9 box with
// resizeMode="cover" - fine for a widescreen photo, but it crops straight
// through anything portrait or square (which is most of what actually
// gets posted - a phone screenshot, a portrait photo). X sizes each image
// to its own real aspect ratio instead of a fixed box, so nothing gets
// cropped; this does the same, asking the image for its real dimensions
// once and sizing the box to match. Clamped to a sane range (very close
// to X's own clamp) so a genuinely extreme panorama or sliver image still
// renders at a reasonable height instead of taking over the screen.
const MIN_RATIO = 0.5; // tall
const MAX_RATIO = 1.91; // wide
const FALLBACK_RATIO = 1.2;

export default function PostImage({ uri, className }: { uri: string; className?: string }) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled || !width || !height) return;
        setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height)));
      },
      () => {
        if (!cancelled) setRatio(FALLBACK_RATIO);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <Image
      source={{ uri }}
      className={className ?? "w-full rounded-2xl bg-white/5"}
      style={{ aspectRatio: ratio ?? FALLBACK_RATIO }}
      resizeMode="cover"
    />
  );
}
