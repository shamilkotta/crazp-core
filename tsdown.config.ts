import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/build/index.ts",
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
      "rolldown",
      "@cloudflare/think",
      "agents",
      "ai",
      "crazp",
      "virtual:crazp/tools/agent",
      "virtual:crazp/tools/subagents"
    ]
  }
});
