import { createWorker } from "@cloudflare/worker-bundler";
import { tool, type Tool } from "ai";
import { z } from "zod";

const RUNNER = "src/__runner.ts";

function buildRunnerModule(userCode: string): string {
  return `${userCode}

export async function main(): Promise<unknown> {
  if (typeof run === "function") return run();
  throw new Error("Tier-2 bundle code must export async function run(): unknown");
}

export default {
  async fetch(): Promise<Response> {
    try {
      const result = await main();
      return Response.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }
};
`;
}

export function createExecuteBundleTool(loader: WorkerLoader): Tool {
  return tool({
    description:
      "Tier 2 — execute TypeScript with npm dependencies in an isolated Dynamic Worker.",
    inputSchema: z.object({
      code: z.string(),
      dependencies: z.record(z.string(), z.string()).optional(),
      timeout: z.number().int().positive().max(120_000).optional()
    }),
    execute: async ({ code, dependencies, timeout }) => {
      const files: Record<string, string> = {
        [RUNNER]: buildRunnerModule(code),
        "package.json": JSON.stringify({
          type: "module",
          dependencies: dependencies ?? {}
        })
      };
      const { mainModule, modules, warnings } = await createWorker({
        files,
        entryPoint: RUNNER,
        conditions: ["workerd", "worker", "import", "default"]
      });
      const id = `bundle-${crypto.randomUUID()}`;
      const worker = loader.get(id, () => ({
        mainModule,
        modules,
        compatibilityDate: "2026-07-24",
        compatibilityFlags: ["nodejs_compat"],
        globalOutbound: null
      }));
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort("execute_bundle timeout"),
        timeout ?? 60_000
      );
      try {
        const response = await worker
          .getEntrypoint()
          .fetch("http://bundle/run", { signal: controller.signal });
        const body = (await response.json()) as {
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        if (!response.ok || body.ok === false) {
          return {
            ok: false,
            error: body.error ?? `HTTP ${response.status}`,
            warnings
          };
        }
        return { ok: true, result: body.result, warnings };
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
