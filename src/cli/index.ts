#!/usr/bin/env node
import { buildCrazpProject } from "../build/index.js";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "build" || command == null) {
    await buildCrazpProject();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: crazp build");
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
