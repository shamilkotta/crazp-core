import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/build/index.ts",
    "src/build/worker-entry.ts",
    "src/cli/index.ts",
    "src/ctx.ts",
    "src/worker/index.ts"
  ],
  format: "esm",
  dts: true,
  sourcemap: false,
  clean: true,
  unbundle: true,
  fixedExtension: false,
  platform: "node",
  deps: {
    neverBundle: [
      "esbuild",
      "@cloudflare/think",
      "@cloudflare/codemode",
      "agents",
      "ai",
      "crazp",
      "virtual:crazp/agent-classes",
      "virtual:crazp/tools/agent",
      "virtual:crazp/tools/subagents"
    ]
  }
});
