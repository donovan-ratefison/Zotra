// Local UI state of the studio: the selected node, the active
// panel tab, the studio mode, and the open test case. The shell, the
// diagram, the node panel and the test screen share it.

import { create } from "zustand";

export type PanelTab = "general" | "requirements" | "scope";
export type StudioMode = "design" | "test";

interface StudioState {
  selectedNodeId: string | null;
  tab: PanelTab;
  mode: StudioMode;
  testCaseId: string | null;
  select: (nodeId: string | null) => void;
  setTab: (tab: PanelTab) => void;
  setMode: (mode: StudioMode) => void;
  setTestCaseId: (id: string | null) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  selectedNodeId: null,
  tab: "general",
  mode: "design",
  testCaseId: null,
  select: (nodeId) => set({ selectedNodeId: nodeId }),
  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode, selectedNodeId: null }),
  setTestCaseId: (id) => set({ testCaseId: id }),
}));
