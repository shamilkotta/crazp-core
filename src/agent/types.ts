import type { CrazpAgentManifest } from "../types";
import type { Sandbox } from "@cloudflare/sandbox";

export type SerializedCrazpManifest = Omit<
  CrazpAgentManifest,
  "tools" | "subagents" | "channels"
> & {
  toolNames: string[];
  channelNames: string[];
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
  SANDBOX: DurableObjectNamespace<Sandbox>;
  [key: string]: unknown;
};
