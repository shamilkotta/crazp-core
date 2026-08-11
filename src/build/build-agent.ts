import {
  buildSourceFileMap,
  bundleWorker,
  bundleWorkerWithWorkerBundler
} from "./bundle";
import { discoverAgentFromFiles, type SourceFile } from "./discovery";
import { buildVirtualModules } from "./virtual-modules";
import { createWranglerConfig } from "./wrangler";

export type BuildAgentInput = {
  files: SourceFile[];
  agentDir?: string;
};

export type BuildOutputFile = {
  path: string;
  content: string;
  contentType?: string;
};

export type BuildAgentOutput = {
  files: BuildOutputFile[];
  workerScript: string;
  wranglerConfig: Record<string, unknown>;
};

export async function buildAgent(
  input: BuildAgentInput,
  bundler: "rolldown" | "worker-bundler" = "rolldown"
): Promise<BuildAgentOutput> {
  const sourceFiles = buildSourceFileMap(input.files);
  const manifest = await discoverAgentFromFiles(input.files, {
    agentDir: input.agentDir
  });
  const virtualContext = buildVirtualModules(manifest);
  const bundle =
    bundler === "worker-bundler"
      ? await bundleWorkerWithWorkerBundler(virtualContext, sourceFiles)
      : await bundleWorker(virtualContext, sourceFiles);
  const wranglerConfig = createWranglerConfig({
    agentName: manifest.name,
    thinkManifest: virtualContext.thinkManifest
  });

  const files: BuildOutputFile[] = [
    {
      path: "index.js",
      content: bundle.workerScript,
      contentType: "application/javascript+module"
    },
    {
      path: "wrangler.json",
      content: `${JSON.stringify(wranglerConfig, null, 2)}\n`,
      contentType: "application/json"
    },
    ...bundle.files
  ];

  return {
    files,
    workerScript: bundle.workerScript,
    wranglerConfig
  };
}
