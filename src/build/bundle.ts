import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "@cloudflare/worker-bundler";
import { rolldown, type Plugin, type RolldownOutput } from "rolldown";

import { toVirtualId, type VirtualBuildContext } from "./virtual-modules";

export type BundleMemoryResult = {
  workerScript: string;
  files: Array<{ path: string; content: string; contentType?: string }>;
};

export function resolveWorkerRuntimePath(): string {
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  return join(packageRoot, "src/worker/index.ts");
}

export function resolveWorkerEntryPath(): string {
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  return join(packageRoot, "src/build/worker-entry.ts");
}

export function resolveCtxModulePath(): string {
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  return join(packageRoot, "src/ctx.ts");
}

function resolveCrazpPackagePath(): string {
  return fileURLToPath(import.meta.resolve("crazp"));
}

function createBundleOptions(
  virtualContext: VirtualBuildContext,
  sourceFiles?: Map<string, string>
) {
  const workerRuntime = resolveWorkerRuntimePath();
  const workerEntry = resolveWorkerEntryPath();
  const ctxModule = resolveCtxModulePath();
  const plugins: Plugin[] = [crazpVirtualPlugin(virtualContext)];

  if (sourceFiles && sourceFiles.size > 0) {
    plugins.push(userSourceFilesPlugin(sourceFiles));
  }

  return {
    input: workerEntry,
    platform: "node" as const,
    moduleTypes: {
      ".wasm": "asset" as const
    },
    plugins,
    external: ["cloudflare:workers", "@mongodb-js/zstd", "cloudflare:email"],
    resolve: {
      alias: {
        "@crazp/core/worker": workerRuntime,
        "crazp:ctx": ctxModule,
        crazp: resolveCrazpPackagePath(),
        "@cloudflare/think/server-entry": fileURLToPath(
          import.meta.resolve("@cloudflare/think/server-entry")
        )
      },
      extensionAlias: {
        ".js": [".ts", ".js"]
      }
    }
  };
}

export async function bundleWorker(
  virtualContext: VirtualBuildContext,
  sourceFiles?: Map<string, string>
): Promise<BundleMemoryResult> {
  const bundle = await rolldown(
    createBundleOptions(virtualContext, sourceFiles)
  );
  const output = await bundle.generate({
    format: "esm",
    sourcemap: false,
    codeSplitting: false,
    assetFileNames: "assets/[name][extname]"
  });

  return formatBundleOutput(output);
}

export async function bundleWorkerWithWorkerBundler(
  virtualContext: VirtualBuildContext,
  sourceFiles?: Map<string, string>
): Promise<BundleMemoryResult> {
  const files = Object.fromEntries(sourceFiles ?? []);
  files["src/index.ts"] = `import thinkEntry from "virtual:think/entry";
import { handleFrameworkRequest } from "@crazp/core/worker";

export * from "virtual:think/agents";
export { CodemodeRuntime } from "@cloudflare/think/server-entry";
export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const frameworkResponse = await handleFrameworkRequest(request);
    if (frameworkResponse) return frameworkResponse;
    return thinkEntry.fetch(request, env, ctx);
  }
};
`;
  files["package.json"] ??= JSON.stringify({
    type: "module",
    dependencies: {
      "@cloudflare/sandbox": "latest",
      "@cloudflare/shell": "latest",
      "@cloudflare/think": "latest",
      agents: "latest",
      ai: "^7.0.0",
      crazp: "latest",
      zod: "^4.4.3"
    }
  });

  const virtualModules = toWorkerBundlerVirtualModules(virtualContext);
  const { mainModule, modules } = await createWorker({
    files,
    entryPoint: "src/index.ts",
    bundle: true,
    conditions: ["workerd", "worker", "browser", "import", "default"],
    externals: ["cloudflare:workers", "cloudflare:email"],
    virtualModules
  });
  const main = modules[mainModule];
  if (typeof main !== "string") {
    throw new Error(
      `Worker bundler main module "${mainModule}" was not JavaScript text.`
    );
  }

  const extraFiles: BundleMemoryResult["files"] = [];
  for (const [path, module] of Object.entries(modules)) {
    if (path === mainModule) continue;
    if (typeof module === "string") {
      extraFiles.push({
        path,
        content: module,
        contentType: guessContentType(path)
      });
      continue;
    }
    if ("js" in module && typeof module.js === "string") {
      extraFiles.push({
        path,
        content: module.js,
        contentType: "application/javascript"
      });
      continue;
    }
    if ("text" in module && typeof module.text === "string") {
      extraFiles.push({
        path,
        content: module.text,
        contentType: guessContentType(path)
      });
      continue;
    }
    throw new Error(
      `Worker bundler emitted unsupported non-text module "${path}". Deploy support needs module upload wiring.`
    );
  }

  return { workerScript: main, files: extraFiles };
}

function formatBundleOutput(output: RolldownOutput): BundleMemoryResult {
  const files: BundleMemoryResult["files"] = [];
  let workerScript = "";

  for (const item of output.output) {
    if (item.type === "chunk") {
      if (!workerScript || item.isEntry) {
        workerScript = item.code;
      }
      continue;
    }

    files.push({
      path: item.fileName,
      content:
        typeof item.source === "string"
          ? item.source
          : Buffer.from(item.source).toString("utf8"),
      contentType: guessContentType(item.fileName)
    });
  }

  if (!workerScript) {
    throw new Error("Worker bundle did not produce an entry chunk.");
  }

  return { workerScript, files };
}

function guessContentType(path: string): string | undefined {
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".js")) return "application/javascript";
  return undefined;
}

function toWorkerBundlerVirtualModules(
  context: VirtualBuildContext
): Record<string, string> {
  const modules: Record<string, string> = {
    "@crazp/core/worker": `export { createCrazpAgentClass, createCrazpWorkerClass } from "crazp/worker";

export async function handleFrameworkRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  return null;
}
`
  };

  for (const [id, source] of context.modules) {
    const specifier = id.startsWith("\0") ? id.slice(1) : id;
    modules[specifier] = source;
    if (specifier.startsWith("virtual:")) {
      modules[`${specifier}.js`] = source;
    }
  }

  return modules;
}

export async function evaluateConfigModule(
  entryPath: string,
  files: Map<string, string>
): Promise<unknown> {
  const bundle = await rolldown({
    input: normalizePath(entryPath),
    platform: "node",
    plugins: [userSourceFilesPlugin(files)],
    resolve: {
      alias: {
        crazp: resolveCrazpPackagePath()
      },
      extensionAlias: {
        ".js": [".ts", ".js"]
      }
    }
  });

  const output = await bundle.generate({ format: "esm" });
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") {
    throw new Error(`Failed to evaluate config module "${entryPath}".`);
  }

  const url = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`;
  const mod = (await import(url)) as { default?: unknown };
  return mod.default ?? null;
}

export function buildSourceFileMap(
  files: Array<{ path: string; content: string }>
): Map<string, string> {
  return new Map(files.map((file) => [normalizePath(file.path), file.content]));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function userSourceFilesPlugin(files: Map<string, string>): Plugin {
  return {
    name: "crazp-user-files",
    resolveId(source, importer) {
      const direct = normalizePath(source);
      if (files.has(direct)) {
        return direct;
      }

      if (importer) {
        const resolved = normalizePath(
          join(dirname(importer), source).replace(/\\/g, "/")
        );
        if (files.has(resolved)) {
          return resolved;
        }
      }

      return null;
    },
    load(id) {
      const source = files.get(normalizePath(id));
      if (source == null) return null;
      return { code: source, moduleType: "ts" };
    }
  };
}

export function crazpVirtualPlugin(context: VirtualBuildContext): Plugin {
  const { modules } = context;

  return {
    name: "crazp-virtual",
    resolveId(id) {
      if (id.startsWith("virtual:")) {
        const virtualId = toVirtualId(id.replace(/\.js$/, ""));
        if (modules.has(virtualId)) {
          return { id: virtualId, moduleSideEffects: false };
        }
        return { id: toVirtualId(id), moduleSideEffects: false };
      }

      if (id.startsWith("/agents/") && id.endsWith(".ts")) {
        const virtualId = toVirtualId(`virtual:crazp${id.slice(0, -3)}`);
        if (modules.has(virtualId)) {
          return { id: virtualId, moduleSideEffects: false };
        }
      }

      return null;
    },
    load(id) {
      const source = modules.get(id);
      if (source == null) return null;
      return { code: source, moduleType: "ts" };
    }
  };
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index);
}
