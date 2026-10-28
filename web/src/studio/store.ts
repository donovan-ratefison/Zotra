// Local UI state of the studio: the selected node and the active
// panel tab. The shell, the diagram and the node panel share it.

import { create } from "zustand";

export type PanelTab = "general" | "requirements" | "scope";

interface StudioState {
  selectedNodeId: string | null;
  tab: PanelTab;
  select: (nodeId: string | null) => void;
  setTab: (tab: PanelTab) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  selectedNodeId: null,
  tab: "general",
  select: (nodeId) => set({ selectedNodeId: nodeId }),
  setTab: (tab) => set({ tab }),
}));
