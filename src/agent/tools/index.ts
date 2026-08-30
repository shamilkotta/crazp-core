import { createBrowserTools } from "@cloudflare/think/tools/browser";
import { createExtensionTools } from "@cloudflare/think/tools/extensions";
import type { ExtensionManager } from "@cloudflare/think/extensions";
import type { ToolSet } from "ai";

import type { CrazpComputerWorkspace } from "../computer";
import type { ActivePlan } from "./todo";
import type { SerializedCrazpManifest } from "../types";
import { buildComputerToolSet } from "./workspace";

export type BuildExecutionToolsOptions = {
  ctx: DurableObjectState;
  env: {
    BROWSER: Fetcher;
    LOADER: WorkerLoader;
  };
  getWorkspace: () => CrazpComputerWorkspace;
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
  execution: SerializedCrazpManifest["execution"];
  extensions?: boolean;
  extensionManager?: ExtensionManager;
};

export function buildExecutionTools(options: BuildExecutionToolsOptions) {
  const {
    ctx,
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
      buildComputerToolSet({
        getWorkspace,
        setActivePlan,
        enableContainer: execution.container
      })
    );
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

  if (extensions && extensionManager) {
    Object.assign(tools, createExtensionTools({ manager: extensionManager }));
    Object.assign(tools, extensionManager.getTools());
  }

  return tools;
}
