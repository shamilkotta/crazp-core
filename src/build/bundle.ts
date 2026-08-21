import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  build as esbuild,
  type Plugin as EsbuildPlugin,
  type PluginBuild
} from "esbuild";

import { resolveBuildPaths } from "./config";
import { toVirtualId, type VirtualBuildContext } from "./virtual-modules";

function resolvePackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

export function resolveWorkerRuntimePath(): string {
  return join(resolvePackageRoot(), "dist/worker/index.js");
}

export function resolveWorkerEntryPath(): string {
  return join(resolvePackageRoot(), "dist/build/worker-entry.js");
}

export function resolveCtxModulePath(): string {
  return join(resolvePackageRoot(), "dist/ctx.js");
}

function resolveCrazpPackagePath(): string {
  return fileURLToPath(import.meta.resolve("crazp"));
}

const CLOUDFLARE_BUILTINS = [
  "cloudflare:email",
  "cloudflare:node",
  "cloudflare:sockets",
  "cloudflare:workers",
  "cloudflare:workflows"
] as const;

const WORKER_BUILD_CONDITIONS = [
  "workerd",
  "worker",
  "module",
  "browser"
] as const;

// TODO: cloudflare plugin doing some polyfills for these, we've to do the same
const NODE_BUILTINS = [
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`)
];

const WORKER_EXTERNALS = [...CLOUDFLARE_BUILTINS, ...NODE_BUILTINS];

const WORKER_ASSET_LOADERS = {
  ".avif": "file",
  ".gif": "file",
  ".jpg": "file",
  ".jpeg": "file",
  ".png": "file",
  ".svg": "file",
  ".webp": "file",
  ".woff": "file",
  ".woff2": "file",
  ".wasm": "file"
} as const;

export type BundleWorkerToDirectoryOptions = {
  projectRoot?: string;
};

export async function bundleWorkerToDirectory(
  virtualContext: VirtualBuildContext,
  options: BundleWorkerToDirectoryOptions = {}
): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const { outDir } = resolveBuildPaths(projectRoot);
  const nodeEnv = JSON.stringify(process.env.NODE_ENV || "production");

  await esbuild({
    entryPoints: [resolveWorkerEntryPath()],
    outdir: outDir,
    bundle: true,
    splitting: true,
    entryNames: "index",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    format: "esm",
    platform: "neutral",
    target: "es2024",
    mainFields: ["module", "main"],
    conditions: [...WORKER_BUILD_CONDITIONS],
    absWorkingDir: projectRoot,
    sourcemap: false,
    keepNames: true,
    external: WORKER_EXTERNALS,
    define: {
      "process.env.NODE_ENV": nodeEnv,
      "global.process.env.NODE_ENV": nodeEnv,
      "globalThis.process.env.NODE_ENV": nodeEnv
    },
    plugins: [
      crazpAliasEsbuildPlugin(),
      crazpVirtualEsbuildPlugin(virtualContext, projectRoot)
    ],
    loader: { ...WORKER_ASSET_LOADERS },
    logLevel: "warning"
  });

  return outDir;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function evaluateConfigModuleFromFileSystem(
  entryPath: string,
  projectRoot: string
): Promise<unknown> {
  const { tempDir } = resolveBuildPaths(projectRoot);
  await mkdir(tempDir, { recursive: true });
  const tempRoot = await mkdtemp(join(tempDir, "config-"));
  const outFile = join(tempRoot, "config.mjs");
  await esbuild({
    entryPoints: [join(projectRoot, normalizePath(entryPath))],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    absWorkingDir: projectRoot,
    external: [...CLOUDFLARE_BUILTINS],
    alias: {
      crazp: resolveCrazpPackagePath()
    },
    plugins: [projectSourceFilesEsbuildPlugin(projectRoot)],
    logLevel: "silent"
  });
  const mod = (await import(`${pathToFileURL(outFile)}?t=${Date.now()}`)) as {
    default?: unknown;
  };
  return mod.default ?? null;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function crazpAliasEsbuildPlugin(): EsbuildPlugin {
  const aliases = new Map([
    ["@crazp/core/worker", resolveWorkerRuntimePath()],
    ["crazp:ctx", resolveCtxModulePath()],
    ["crazp", resolveCrazpPackagePath()]
  ]);

  return {
    name: "crazp-alias",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const target = aliases.get(args.path);
        if (!target) return;
        return { path: target };
      });
    }
  };
}

function projectSourceFilesEsbuildPlugin(projectRoot: string): EsbuildPlugin {
  return {
    name: "crazp-project-source-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const sourcePath = resolveEsbuildSourceFilePath(args, projectRoot);
        if (!sourcePath) return;

        const sourceFilePath = await resolveExistingProjectSourceFilePath(
          sourcePath,
          projectRoot
        );
        if (!sourceFilePath) return;

        return { path: join(projectRoot, sourceFilePath) };
      });
    }
  };
}

export function crazpVirtualEsbuildPlugin(
  context: VirtualBuildContext,
  projectRoot: string
): EsbuildPlugin {
  const { modules } = context;

  return {
    name: "crazp-virtual",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const sourcePath = resolveEsbuildSourceFilePath(args, projectRoot);
        if (sourcePath) {
          const virtualId = toVirtualId(`virtual:crazp/${sourcePath}`);
          if (modules.has(virtualId)) {
            return { path: virtualId, namespace: "crazp-virtual" };
          }

          const projectSourceFilePath =
            await resolveExistingProjectSourceFilePath(sourcePath, projectRoot);
          if (projectSourceFilePath) {
            return { path: join(projectRoot, projectSourceFilePath) };
          }
        }

        const directId = toVirtualId(args.path.replace(/\.js$/, ""));
        if (modules.has(directId)) {
          return { path: directId, namespace: "crazp-virtual" };
        }
        if (args.namespace === "crazp-virtual") {
          return { path: join(projectRoot, args.path) };
        }
      });
      build.onLoad({ filter: /.*/, namespace: "crazp-virtual" }, (args) => {
        const contents = modules.get(args.path);
        if (contents == null) return;
        return { contents, loader: "ts", resolveDir: projectRoot };
      });
    }
  };
}

function resolveEsbuildSourceFilePath(
  args: Parameters<Parameters<PluginBuild["onResolve"]>[1]>[0],
  projectRoot: string
): string | undefined {
  if (args.path.startsWith("/agents/")) {
    return args.path.slice(1).replace(/\.ts$/, "");
  }
  if (args.namespace === "crazp-virtual") {
    const importerPath = args.importer.replace(/^virtual:crazp\//, "");
    return normalizePath(join(dirname(importerPath), args.path)).replace(
      /\.ts$/,
      ""
    );
  }
  const resolved = isAbsolute(args.path)
    ? args.path
    : join(args.resolveDir || projectRoot, args.path);
  if (isOutsideDirectory(projectRoot, resolved)) return;
  return normalizePath(resolved.slice(projectRoot.length + 1)).replace(
    /\.[cm]?[jt]sx?$/,
    ""
  );
}

async function resolveExistingProjectSourceFilePath(
  sourcePath: string,
  projectRoot: string
): Promise<string | undefined> {
  for (const candidate of sourcePathCandidates(sourcePath)) {
    if (await exists(join(projectRoot, candidate))) {
      return candidate;
    }
  }
}

function sourcePathCandidates(sourcePath: string) {
  return [
    sourcePath,
    `${sourcePath}.ts`,
    `${sourcePath}.tsx`,
    `${sourcePath}.js`,
    `${sourcePath}.jsx`,
    `${sourcePath}/index.ts`,
    `${sourcePath}/index.tsx`,
    `${sourcePath}/index.js`,
    `${sourcePath}/index.jsx`
  ].map(normalizePath);
}

function isOutsideDirectory(rootDir: string, path: string) {
  const relativePath = relative(rootDir, path);
  return relativePath === ".." || relativePath.startsWith(`../`);
}

const exists = (path: string) =>
  stat(path)
    .then(() => true)
    .catch((error) => {
      if (isMissingFileError(error)) return false;
      throw error;
    });

function stripVirtualPrefix(id: string): string {
  return id.charCodeAt(0) === 0 ? id.slice(1) : id;
}

function dirname(path: string): string {
  const normalized = normalizePath(stripVirtualPrefix(path));
  const importerPath = normalized.replace(/^virtual:crazp\//, "");
  const index = importerPath.lastIndexOf("/");
  if (index <= 0) return ".";
  return importerPath.slice(0, index);
}
