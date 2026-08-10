import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  BuildFilesystemAgentOutput,
  BuildOutputFile
} from "./build-agent";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "coverage",
  "node_modules"
]);

export type CollectProjectSourceFilesOptions = {
  rootDir: string;
  agentDir?: string;
};

export async function collectProjectSourceFiles(
  options: CollectProjectSourceFilesOptions
): Promise<Array<{ path: string; content: string }>> {
  const agentDir = options.agentDir ?? "agent";
  const agentRoot = join(options.rootDir, agentDir);
  if (!(await exists(agentRoot))) {
    throw new Error(`Agent directory "${agentRoot}" is missing`);
  }

  const files: Array<{ path: string; content: string }> = [];
  await walkDirectory(agentRoot, agentDir.replace(/\\/g, "/"), files);
  return files;
}

async function walkDirectory(
  absoluteDir: string,
  relativeDir: string,
  files: Array<{ path: string; content: string }>
) {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const relativePath = `${relativeDir}/${entry.name}`.replace(/\\/g, "/");
    const absolutePath = join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, relativePath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    files.push({
      path: relativePath,
      content: await readFile(absolutePath, "utf8")
    });
  }
}

export async function writeBuildOutput(
  outDir: string,
  output: BuildFilesystemAgentOutput
): Promise<{ workerPath: string; wranglerPath: string }> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const file of output.files) {
    await writeOutputFile(outDir, file);
  }

  return {
    workerPath: join(outDir, "index.js"),
    wranglerPath: join(outDir, "wrangler.json")
  };
}

async function writeOutputFile(outDir: string, file: BuildOutputFile) {
  const outputPath = join(outDir, file.path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, file.content, "utf8");
}

async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}
