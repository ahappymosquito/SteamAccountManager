/** Persistent in-memory CFG draft with serialized saves for switch-time flushing. */
import { create } from "zustand";
import { api } from "./lib/api";
import type { CfgProfile } from "./lib/types";

type Draft = Pick<CfgProfile, "id" | "name" | "fileName" | "content">;

type CfgWorkspace = {
  draft?: Draft;
  revision: number;
  savedRevision: number;
  saving: boolean;
  load: (profile: CfgProfile) => void;
  edit: (patch: Partial<Pick<Draft, "name" | "content">>) => void;
  isDirty: () => boolean;
};

export const useCfgWorkspace = create<CfgWorkspace>((set, get) => ({
  revision: 0,
  savedRevision: 0,
  saving: false,
  load: (profile) =>
    set({
      draft: {
        id: profile.id,
        name: profile.name,
        fileName: profile.fileName,
        content: profile.content,
      },
      revision: 0,
      savedRevision: 0,
      saving: false,
    }),
  edit: (patch) =>
    set((state) => ({
      draft: state.draft ? { ...state.draft, ...patch } : undefined,
      revision: state.revision + 1,
    })),
  isDirty: () => get().revision !== get().savedRevision,
}));

let pendingFlush: Promise<void> | undefined;

async function runFlush() {
  useCfgWorkspace.setState({ saving: true });
  try {
    while (true) {
      const state = useCfgWorkspace.getState();
      if (!state.draft || state.revision === state.savedRevision) return;
      const revision = state.revision;
      const draft = state.draft;
      await api.saveCfgProfile(draft.id, draft.name, draft.content);
      useCfgWorkspace.setState({ savedRevision: revision });
    }
  } finally {
    useCfgWorkspace.setState({ saving: false });
  }
}

export function flushCfgDraft(): Promise<void> {
  if (!pendingFlush) {
    pendingFlush = runFlush().finally(() => {
      pendingFlush = undefined;
    });
  }
  return pendingFlush;
}
