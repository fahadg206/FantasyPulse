"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  className?: string;
  /** briefly tints the number green (increase) or red (decrease) while it animates */
  colorFlash?: boolean;
}

// Generic "animate a displayed number from its old value to its new one"
// component - green and counting up on an increase, red and counting down
// on a decrease. Used wherever a live score needs to visibly react to a
// change instead of just silently updating.
const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  decimals = 2,
  className = "",
  colorFlash = true,
}) => {
  const [display, setDisplay] = useState(value);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const prevValue = useRef(value);
  const hasMounted = useRef(false);

  useEffect(() => {
    // don't animate the very first render, only real changes after that
    if (!hasMounted.current) {
      hasMounted.current = true;
      prevValue.current = value;
      setDisplay(value);
      return;
    }

    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    if (colorFlash) {
      setFlashColor(to > from ? "text-green-500" : "text-red-500");
    }

    const controls = animate(from, to, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(latest),
      onComplete: () => {
        prevValue.current = to;
        if (colorFlash) {
          setTimeout(() => setFlashColor(null), 600);
        }
      },
    });

    return () => controls.stop();
  }, [value, colorFlash]);

  return (
    <span
      className={`${className} ${
        flashColor || ""
      } transition-colors duration-500`}
    >
      {display.toFixed(decimals)}
    </span>
  );
};

export default AnimatedNumber;
