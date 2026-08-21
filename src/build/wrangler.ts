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
  outfile?: string;
}): WranglerConfig {
  const workerName = args.agentName;
  const mainClassName = toThinkClassName(args.agentName);
  const durableObjectBindings = [
    {
      class_name: mainClassName,
      name: mainClassName
    }
  ];

  if (args.agentName !== mainClassName && args.agentName !== "SANDBOX") {
    durableObjectBindings.push({
      class_name: mainClassName,
      name: args.agentName
    });
  }

  durableObjectBindings.push({
    class_name: "Sandbox",
    name: "SANDBOX"
  });

  return {
    ...DEFAULT_BINDINGS,
    name: workerName,
    main: args.outfile ?? "index.js",
    no_bundle: true,
    rules: [
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
      { type: "CompiledWasm", globs: ["**/*.wasm"] }
    ],
    durable_objects: {
      bindings: durableObjectBindings
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: [mainClassName, "Sandbox"]
      }
    ]
  };
}
