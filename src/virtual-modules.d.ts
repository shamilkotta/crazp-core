declare module "virtual:crazp/agent-classes" {
  export {};
}

declare module "virtual:crazp/tools/agent" {
  import type { ToolSet } from "ai";

  const tools: ToolSet;
  export default tools;
}

declare module "virtual:crazp/tools/subagents" {
  import type { ToolSet } from "ai";

  const tools: Record<string, ToolSet>;
  export default tools;
}

declare module "virtual:crazp/channels" {
  import type { CrazpChannelModule } from "crazp/channels";

  const channels: Record<string, CrazpChannelModule>;
  export default channels;
}

declare module "@crazp/core/worker" {
  import type { ToolSet } from "ai";
  import type { CrazpAgentManifest } from "../types";
  import type { SerializedCrazpManifest } from "../agent/types";

  export function createCrazpAgentClass(
    manifest: SerializedCrazpManifest,
    className: string,
    workerClasses: Record<string, unknown>
  ): unknown;

  export function createCrazpWorkerClass(
    manifest: SerializedCrazpManifest,
    subagentKey: string,
    className: string
  ): unknown;

  export function buildExecutionTools(...args: unknown[]): ToolSet;
  export function buildSharedToolSet(...args: unknown[]): ToolSet;
  export function handleFrameworkRequest(
    request: Request
  ): Promise<Response | null>;
}
