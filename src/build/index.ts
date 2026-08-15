import ora from "ora";

import { buildAgent } from "./build-agent";
import { resolveBuildPaths } from "./config";
import { runWithSpinner } from "../lib";

export type BuildOptions = {
  projectRoot?: string;
  agentDir?: string;
};

export type BuildResult = {
  projectRoot: string;
  outDir: string;
  workerPath: string;
  wranglerPath: string;
};

export {
  buildAgent,
  type BuildAgentInput,
  type BuildAgentOutput,
  type BuildPhaseRunner
} from "./build-agent";

export async function buildCrazpProject(
  options: BuildOptions = {}
): Promise<BuildResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const agentDir = options.agentDir ?? "agent";

  ora().info("building agent");

  const output = await buildAgent({
    projectRoot,
    agentDir,
    runPhase: (text, fn) => runWithSpinner(text, fn, { indent: 2 })
  });

  ora().succeed("crazp build completed");

  return {
    projectRoot,
    outDir: resolveBuildPaths(projectRoot).outDir,
    workerPath: output.workerPath,
    wranglerPath: output.wranglerPath
  };
}
