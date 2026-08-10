import type { CrazpExecutionConfig } from "crazp";

export const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";

export const DEFAULT_EXECUTION: Required<CrazpExecutionConfig> = {
  workspaceTools: true,
  execute: true,
  executeBundle: true,
  browser: true,
  sandbox: true
};
