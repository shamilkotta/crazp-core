import type { CrazpAgentManifest } from "../types";

export type SerializedCrazpManifest = Omit<
  CrazpAgentManifest,
  "tools" | "subagents"
> & {
  toolNames: string[];
  subagents: Record<
    string,
    Omit<CrazpAgentManifest["subagents"][string], "tools"> & {
      toolNames: string[];
    }
  >;
};

export type CrazpWorkerEnv = {
  AI: Ai;
  WORKSPACE_BUCKET: R2Bucket;
  BROWSER: Fetcher;
  LOADER: WorkerLoader;
  [key: string]: unknown;
};
