import { createThinkWorkerConfig } from "@cloudflare/think/framework";

import { toThinkClassName } from "./names";

export type WranglerConfig = Record<string, unknown>;

const DEFAULT_BINDINGS: WranglerConfig = {
  compatibility_date: new Date().toISOString().slice(0, 10),
  compatibility_flags: ["nodejs_compat"],
  ai: { binding: "AI" },
  r2_buckets: [
    {
      binding: "WORKSPACE_BUCKET",
      bucket_name: "crazp-workspace"
    }
  ],
  browser: { binding: "BROWSER" },
  worker_loaders: [{ binding: "LOADER" }],
  containers: [
    {
      class_name: "Sandbox",
      image: "./Dockerfile",
      instance_type: "lite",
      max_instances: 3
    }
  ]
};

export function createWranglerConfig(args: {
  agentName: string;
  thinkManifest: Parameters<typeof createThinkWorkerConfig>[0];
  outfile?: string;
}): WranglerConfig {
  const workerName = args.agentName;
  const thinkConfig = createThinkWorkerConfig(args.thinkManifest, {
    name: workerName,
    main: args.outfile ?? "index.js"
  });

  const { assets: _assets, ...thinkWorkerConfig } = thinkConfig;

  const mainClassName = toThinkClassName(args.agentName);
  return {
    ...DEFAULT_BINDINGS,
    ...thinkWorkerConfig,
    name: workerName,
    main: args.outfile ?? "index.js",
    no_bundle: true,
    rules: [
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
      { type: "CompiledWasm", globs: ["**/*.wasm"] }
    ],
    durable_objects: {
      bindings: [
        {
          class_name: mainClassName,
          name: mainClassName
        },
        {
          class_name: "Sandbox",
          name: "SANDBOX"
        }
      ]
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: [mainClassName, "Sandbox"]
      }
    ]
  };
}
