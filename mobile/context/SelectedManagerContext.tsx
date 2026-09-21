import React, { createContext, useContext, useState, ReactNode } from "react";

interface SelectedManagerContextValue {
  selectedManagerr: string;
  setSelectedManagerr: (value: string) => void;
}

const SelectedManagerContext = createContext<SelectedManagerContextValue | undefined>(undefined);

export function SelectedManagerProvider({ children }: { children: ReactNode }) {
  const [selectedManagerr, setSelectedManagerr] = useState("");

  return (
    <SelectedManagerContext.Provider value={{ selectedManagerr, setSelectedManagerr }}>
      {children}
    </SelectedManagerContext.Provider>
  );
}

export function useSelectedManager() {
  const ctx = useContext(SelectedManagerContext);
  if (!ctx) throw new Error("useSelectedManager must be used within SelectedManagerProvider");
  return ctx;
}
