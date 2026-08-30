import { toThinkClassName } from "./names";

export type WranglerConfig = Record<string, unknown>;

const DEFAULT_BINDINGS: WranglerConfig = {
  compatibility_date: new Date().toISOString().slice(0, 10),
  compatibility_flags: ["nodejs_compat", "experimental"],
  ai: { binding: "AI" },
  r2_buckets: [
    {
      binding: "WORKSPACE_BUCKET",
      bucket_name: "crazp-workspace"
    }
  ],
  browser: { binding: "BROWSER" },
  worker_loaders: [{ binding: "LOADER" }]
};

export function createWranglerConfig(args: {
  agentName: string;
  outfile?: string;
  enableContainer?: boolean;
}): WranglerConfig {
  const workerName = args.agentName;
  const mainClassName = toThinkClassName(args.agentName);

  const durableObjectBindings = [
    { class_name: mainClassName, name: mainClassName }
  ];

  if (args.agentName !== mainClassName) {
    durableObjectBindings.push({
      class_name: mainClassName,
      name: args.agentName
    });
  }

  const containers =
    args.enableContainer === false
      ? undefined
      : [
          {
            class_name: mainClassName,
            image: "./Dockerfile",
            instance_type: "standard-2",
            max_instances: 3
          }
        ];

  return {
    ...DEFAULT_BINDINGS,
    name: workerName,
    main: args.outfile ?? "index.js",
    no_bundle: true,
    rules: [
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
      { type: "CompiledWasm", globs: ["**/*.wasm"] }
    ],
    ...(containers ? { containers } : {}),
    durable_objects: {
      bindings: durableObjectBindings
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: [mainClassName]
      }
    ]
  };
}
