import { bundleWorkerToDirectory } from "./bundle";
import { resolveBuildPaths } from "./config";
import { discoverAgentFromProject } from "./discovery";
import { buildVirtualModules } from "./virtual-modules";
import { createWranglerConfig } from "./wrangler";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runWithSpinner } from "../lib";

const DEFAULT_DOCKERFILE = `FROM docker.io/cloudflare/sandbox:0.12.4

EXPOSE 8080
`;

export type BuildPhaseRunner = <T>(
  text: string,
  fn: () => Promise<T>
) => Promise<T>;

export type BuildAgentInput = {
  projectRoot?: string;
  agentDir?: string;
  runPhase?: BuildPhaseRunner;
};

export type BuildAgentOutput = {
  outDir: string;
  workerPath: string;
  wranglerPath: string;
  dockerfilePath: string;
  workerScript: string;
  wranglerConfig: Record<string, unknown>;
};

export async function buildAgent(
  input: BuildAgentInput
): Promise<BuildAgentOutput> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const runPhase =
    input.runPhase ?? ((text, fn) => runWithSpinner(text, fn, { indent: 0 }));
  const { tempDir, outDir } = resolveBuildPaths(projectRoot);

  await runPhase("preparing build dirs", async () => {
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
  });

  const manifest = await runPhase("discovering agent", () =>
    discoverAgentFromProject({
      projectRoot,
      agentDir: input.agentDir
    })
  );

  const virtualContext = buildVirtualModules(manifest);
  await runPhase("bundling worker", async () => {
    await rm(outDir, { recursive: true, force: true });
    await bundleWorkerToDirectory(virtualContext, {
      projectRoot
    });
  });

  const envVars = await loadAgentEnvVars(
    join(projectRoot, manifest.agentDir, "env.json")
  );
  const wranglerConfig = createWranglerConfig({
    agentName: manifest.name,
    vars: envVars
  });
  const workerPath = join(outDir, "index.js");
  const wranglerPath = join(outDir, "wrangler.json");
  const dockerfilePath = join(outDir, "Dockerfile");

  const workerScript = await runPhase("writing output files", async () => {
    await Promise.all([
      writeFile(
        wranglerPath,
        `${JSON.stringify(wranglerConfig, null, 2)}\n`,
        "utf8"
      ),
      writeFile(dockerfilePath, DEFAULT_DOCKERFILE, "utf8")
    ]);
    return readFile(workerPath, "utf8");
  });

  await runPhase("cleaning temp files", () =>
    rm(tempDir, { recursive: true, force: true })
  );

  // TODO: do we need to return these?
  return {
    outDir,
    workerPath,
    wranglerPath,
    dockerfilePath,
    workerScript,
    wranglerConfig
  };
}

async function loadAgentEnvVars(
  path: string
): Promise<Record<string, string> | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      throw new Error(`Invalid env.json at ${path}: expected a JSON object`);
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new Error(
          `Invalid env.json at ${path}: value for "${key}" must be a string`
        );
      }
      vars[key] = value;
    }
    return vars;
  } catch (error) {
    if (
      typeof error === "object" &&
      error != null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}
