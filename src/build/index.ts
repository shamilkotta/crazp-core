import { join } from "node:path";

import ora from "ora";

import { buildAgent } from "./build-agent";
import { collectProjectSourceFiles, writeBuildOutput } from "./fs-io";

export type BuildOptions = {
  projectRoot?: string;
  agentDir?: string;
  outDir?: string;
};

export type BuildResult = {
  projectRoot: string;
  outDir: string;
  workerPath: string;
  wranglerPath: string;
};

async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora(text).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export {
  buildAgent,
  type BuildAgentInput,
  type BuildAgentOutput,
  type BuildOutputFile
} from "./build-agent";

export async function buildCrazpProject(
  options: BuildOptions = {}
): Promise<BuildResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const agentDir = options.agentDir ?? "agent";
  const outDir = options.outDir ?? join(projectRoot, "dist");

  const files = await withSpinner("discovering agent...", () =>
    collectProjectSourceFiles({ rootDir: projectRoot, agentDir })
  );

  const output = await withSpinner("building agent...", () =>
    buildAgent({ files, agentDir })
  );

  const paths = await withSpinner("writing build output...", () =>
    writeBuildOutput(outDir, output)
  );

  ora().succeed("crazp build completed");

  return {
    projectRoot,
    outDir,
    workerPath: paths.workerPath,
    wranglerPath: paths.wranglerPath
  };
}
