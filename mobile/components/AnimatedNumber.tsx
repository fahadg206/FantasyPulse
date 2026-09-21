import { useEffect, useRef, useState } from "react";
import { Text, TextStyle, StyleProp } from "react-native";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  style?: StyleProp<TextStyle>;
  className?: string;
  /** briefly tints the number green (increase) or red (decrease) while it animates */
  colorFlash?: boolean;
}

// RN has no framer-motion, so this is a small self-contained
// requestAnimationFrame tween instead - counts from the old value to the
// new one, green and climbing on an increase, red and falling on a
// decrease. Mirrors src/app/components/AnimatedNumber.tsx on the web app.
export default function AnimatedNumber({
  value,
  decimals = 2,
  style,
  className,
  colorFlash = true,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const prevValue = useRef(value);
  const hasMounted = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      prevValue.current = value;
      setDisplay(value);
      return;
    }

    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    if (colorFlash) setFlashColor(to > from ? "#22c55e" : "#ef4444");

    const duration = 800;
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 2); // easeOut
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = to;
        if (colorFlash) setTimeout(() => setFlashColor(null), 600);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, colorFlash]);

  return (
    <Text
      className={className}
      style={[style, flashColor ? { color: flashColor } : undefined]}
    >
      {display.toFixed(decimals)}
    </Text>
  );
}
