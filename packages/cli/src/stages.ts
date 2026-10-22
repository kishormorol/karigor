import type { FsStore, ProjectState, Stage } from "@karigor/store";

export interface StagePlan {
  stages: Stage[];
  /** Ids of stages that are built and live. */
  built: Set<string>;
  /** The stage being built now, if one is. */
  current?: Stage;
  /** The next stage `grow` would build. */
  next?: Stage;
}

/** The spec's stages and where the build stands among them. */
export async function stagePlan(store: FsStore, state: ProjectState): Promise<StagePlan> {
  const specId = state.artifacts.spec?.at(-1);
  const stages = specId ? (await store.readArtifact("spec", specId)).meta.stages : [];
  const built = new Set(state.stagesBuilt);
  if (state.firstBuilt && stages[0]) built.add(stages[0].id);
  const current = state.status !== "finished" ? (state.stage ? stages.find((s) => s.id === state.stage) : !state.firstBuilt ? stages[0] : undefined) : undefined;
  const next = stages.find((s) => !built.has(s.id) && s.id !== current?.id);
  return { stages, built, ...(current ? { current } : {}), ...(next ? { next } : {}) };
}
