import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PlayerDetailModal from "./PlayerDetailModal";

export interface PlayerRef {
  playerId?: string;
  name: string;
  position: string;
  team?: string;
}

interface PlayerDetailContextValue {
  openPlayer: (player: PlayerRef) => void;
}

const PlayerDetailContext = createContext<PlayerDetailContextValue | null>(null);

/**
 * One player detail modal per league, mounted once at the league layout
 * level instead of every single screen carrying its own copy of the same
 * state + modal render. Any screen anywhere under a league can make a
 * player tappable with nothing more than `usePlayerDetail().openPlayer(...)`
 * - no prop-drilling leagueID or wiring a local modal instance each time.
 * PlayerCard itself already falls back to this automatically whenever a
 * caller doesn't pass its own onExpand.
 */
export function PlayerDetailProvider({ leagueID, children }: { leagueID: string; children: React.ReactNode }) {
  const [player, setPlayer] = useState<PlayerRef | null>(null);

  const openPlayer = useCallback((p: PlayerRef) => setPlayer(p), []);
  const value = useMemo(() => ({ openPlayer }), [openPlayer]);

  return (
    <PlayerDetailContext.Provider value={value}>
      {children}
      <PlayerDetailModal
        visible={!!player}
        onClose={() => setPlayer(null)}
        leagueID={leagueID}
        playerId={player?.playerId}
        name={player?.name ?? ""}
        position={player?.position ?? ""}
        team={player?.team}
      />
    </PlayerDetailContext.Provider>
  );
}

/** null outside a PlayerDetailProvider (e.g. a screen rendered outside any league) rather than throwing - callers check for null and just skip making that one thing tappable, same graceful-degradation spirit as the rest of this app's optional-prop patterns. */
export function usePlayerDetail(): PlayerDetailContextValue | null {
  return useContext(PlayerDetailContext);
}
