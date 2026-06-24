import React from "react";

interface DashboardTabContextValue {
  activeDashTab: string;
  setActiveDashTab: (tab: string) => void;
}

export const DashboardTabContext = React.createContext<DashboardTabContextValue>({
  activeDashTab: "",
  setActiveDashTab: () => {},
});
