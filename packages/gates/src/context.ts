import type { Artifact, ArtifactKind, ArtifactOf, ArtifactRef, BacklogItem, GateName, ProjectState } from "@karigor/store";
import type { Judge } from "./judge.js";
import type { Sandbox } from "./sandbox.js";

export interface ArtifactReader {
  readArtifact<K extends ArtifactKind>(kind: K, id: string): Promise<ArtifactOf<K>>;
  writeArtifact(a: Artifact): Promise<void>;
}

/** Everything a gate may look at. Built by the orchestrator per evaluation. */
export interface GateContext {
  gate: GateName;
  key: string;
  phase: string;
  itemId?: string;
  round?: number;
  transitionTo?: string;
  state: ProjectState;
  store: ArtifactReader;
  sandbox: Sandbox;
  judge: Judge;
  /** Artifacts produced in this scope (and for this item, when item-scoped). */
  produced: ArtifactRef[];
  backlogItem?: BacklogItem;
  /** The same gate's previous verdict in the previous attempt, so a re-review does not move the goalposts. */
  previousReview?: { verdict: "pass" | "fail"; reasons: string[]; minor: string[] };
  /** Injected by the orchestrator from the budget package. */
  budgetCheck?: () => { ok: boolean; reason: string };
  clock: () => Date;
  makeId: (kind: ArtifactKind) => string;
}
