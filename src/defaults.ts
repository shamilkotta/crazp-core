import type { CrazpExecutionConfig } from "crazp";

export const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";

export const DEFAULT_EXECUTION = {
  workspaceTools: true,
  container: true,
  browser: true,
  execute: true,
  executeBundle: true,
  sandbox: true
} satisfies CrazpExecutionConfig;
