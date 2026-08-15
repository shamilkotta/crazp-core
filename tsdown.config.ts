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
      "agents",
      "ai",
      "crazp",
      "virtual:think/agents",
      "virtual:think/entry",
      "virtual:crazp/tools/agent",
      "virtual:crazp/tools/subagents"
    ]
  }
});
