"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FeedPlay } from "../libs/useBigPlayFeed";

interface BigPlayToastProps {
  play: FeedPlay | null;
  /** how long the toast stays up before auto-dismissing, ms */
  durationMs?: number;
}

// A floating notification for a single big play: the player's photo, what
// happened, and their fantasy point swing - green and climbing on a gain,
// red and falling on a loss. Auto-dismisses itself after `durationMs`.
const BigPlayToast: React.FC<BigPlayToastProps> = ({
  play,
  durationMs = 6000,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!play) return;
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timeout);
  }, [play, durationMs]);

  if (!play || play.pointsDelta === null) return null;

  const isPositive = play.pointsDelta >= 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={play.id}
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-2 rounded-lg shadow-lg bg-[#1a1a1a] text-white p-2 pr-3 border border-white/10"
        >
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${play.player.sleeperId}.jpg`}
            alt={`${play.player.fn} ${play.player.ln}`}
            className="w-9 h-9 rounded-full bg-slate-300 object-cover object-top"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-semibold">
              {play.player.fn} {play.player.ln}
            </span>
            <span className="text-[10px] text-gray-300">{play.playType}</span>
          </div>
          <motion.span
            initial={{ scale: 1.4 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4 }}
            className={`ml-2 text-sm font-bold ${
              isPositive ? "text-green-400" : "text-red-400"
            }`}
          >
            {isPositive ? "+" : ""}
            {play.pointsDelta.toFixed(1)}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BigPlayToast;
