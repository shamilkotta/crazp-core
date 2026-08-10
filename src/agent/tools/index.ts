import { createBrowserTools } from "@cloudflare/think/tools/browser";
import {
  createExecuteTool,
  type ExecuteToolAgent
} from "@cloudflare/think/tools/execute";
import { createExtensionTools } from "@cloudflare/think/tools/extensions";
import type { ExtensionManager } from "@cloudflare/think/extensions";
import type { Workspace } from "@cloudflare/shell";
import type { ToolSet } from "ai";

import { buildSharedToolSet } from "./workspace";
import type { ActivePlan } from "./todo";
import type { SerializedCrazpManifest } from "../types";
import { createExecuteBundleTool } from "./execute-bundle";
import { createSandboxTools } from "./sandbox";

export type BuildExecutionToolsOptions = {
  executeAgent: ExecuteToolAgent;
  ctx: DurableObjectState;
  agentName: string;
  env: {
    BROWSER: Fetcher;
    LOADER: WorkerLoader;
    SANDBOX: DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox>;
  };
  getWorkspace: () => Workspace;
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
  execution: SerializedCrazpManifest["execution"];
  extensions?: boolean;
  extensionManager?: ExtensionManager;
};

export function buildExecutionTools(options: BuildExecutionToolsOptions) {
  const {
    executeAgent,
    ctx,
    agentName,
    env,
    getWorkspace,
    setActivePlan,
    execution,
    extensions = false,
    extensionManager
  } = options;

  const tools: ToolSet = {};

  if (execution.workspaceTools) {
    Object.assign(
      tools,
      buildSharedToolSet({
        getWorkspace,
        setActivePlan
      })
    );
  }

  if (execution.execute) {
    tools.execute = createExecuteTool(executeAgent);
  }

  if (execution.executeBundle) {
    tools.execute_bundle = createExecuteBundleTool(env.LOADER);
  }

  if (execution.browser) {
    Object.assign(
      tools,
      createBrowserTools({
        ctx,
        browser: env.BROWSER,
        loader: env.LOADER
      })
    );
  }

  if (execution.sandbox) {
    Object.assign(
      tools,
      createSandboxTools({
        sandbox: env.SANDBOX,
        sandboxId: agentName,
        getWorkspace
      })
    );
  }

  if (extensions && extensionManager) {
    Object.assign(tools, createExtensionTools({ manager: extensionManager }));
    Object.assign(tools, extensionManager.getTools());
  }

  return tools;
}
