import { join } from "node:path";

export const BUILD_DIR = ".crazp";
export const BUILD_TEMP_DIR = "temp";
export const BUILD_OUTPUT_DIR = "output";

export function resolveBuildPaths(projectRoot: string) {
  const buildDir = join(projectRoot, BUILD_DIR);
  return {
    buildDir,
    tempDir: join(buildDir, BUILD_TEMP_DIR),
    outDir: join(buildDir, BUILD_OUTPUT_DIR)
  };
}
