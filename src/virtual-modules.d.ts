declare module "virtual:think/entry" {
  const entry: {
    fetch(
      request: Request,
      env: unknown,
      ctx: ExecutionContext
    ): Response | Promise<Response>;
  };

  export default entry;
}

declare module "virtual:think/agents" {
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
    manifest: CrazpAgentManifest,
    subagentKey: string,
    className: string
  ): unknown;

  export function buildExecutionTools(...args: unknown[]): ToolSet;
  export function buildSharedToolSet(...args: unknown[]): ToolSet;
  export function handleFrameworkRequest(
    request: Request
  ): Promise<Response | null>;
}
