import { createAITools } from "@cloudflare/computer/tools";
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";

import type { CrazpComputerWorkspace } from "../computer";
import {
  CONTAINER_BACKEND_DESCRIPTION,
  SHELL_BACKEND_DESCRIPTION
} from "../computer";
import { isCorePath, normalizeWorkspacePath } from "../core-files";
import type { ActivePlan } from "./todo";
import { createTodoWriteTool } from "./todo";

function assertNotCorePath(path: string): void {
  if (isCorePath(path)) {
    throw new Error(
      "Use set_context or identity file tools for core identity paths."
    );
  }
}

function guardCorePathTool<T extends Tool>(
  toolDef: T,
  paths: (input: unknown) => string[]
): T {
  const originalExecute = toolDef.execute;
  if (!originalExecute) return toolDef;
  return {
    ...toolDef,
    execute: async (input, options) => {
      for (const path of paths(input)) {
        assertNotCorePath(normalizeWorkspacePath(path));
      }
      return originalExecute.call(toolDef, input, options);
    }
  } as T;
}

function toExecPath(path: string): string {
  return path.startsWith("/") ? path : `/${normalizeWorkspacePath(path)}`;
}

function quoteExecPath(path: string): string {
  return JSON.stringify(toExecPath(path));
}

type BuildComputerToolSetOptions = {
  getWorkspace: () => CrazpComputerWorkspace;
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
  enableContainer: boolean;
};

export function buildComputerToolSet(
  options: BuildComputerToolSetOptions
): ToolSet {
  const { getWorkspace, setActivePlan, enableContainer } = options;
  const workspace = getWorkspace();

  const tools = createAITools({
    workspace,
    assets: false,
    shell: {
      defaultBackend: "shell",
      backends: {
        shell: { description: SHELL_BACKEND_DESCRIPTION },
        ...(enableContainer
          ? { container: { description: CONTAINER_BACKEND_DESCRIPTION } }
          : {})
      }
    }
  });

  if (tools.write?.execute) {
    tools.write = guardCorePathTool(tools.write, (input) => [
      (input as { path: string }).path
    ]);
  }
  if (tools.edit?.execute) {
    tools.edit = guardCorePathTool(tools.edit, (input) => [
      (input as { path: string }).path
    ]);
  }
  if (tools.delete?.execute) {
    tools.delete = guardCorePathTool(tools.delete, (input) => [
      (input as { path: string }).path
    ]);
  }

  tools.move = tool({
    description: "Move or rename a file or directory inside the workspace.",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      recursive: z.boolean().optional()
    }),
    execute: async ({ from, to, recursive }) => {
      const normalizedFrom = normalizeWorkspacePath(from);
      const normalizedTo = normalizeWorkspacePath(to);
      assertNotCorePath(normalizedFrom);
      assertNotCorePath(normalizedTo);
      const ws = getWorkspace();
      const handle = await ws.runtime.exec(
        `mv ${quoteExecPath(normalizedFrom)} ${quoteExecPath(normalizedTo)}`,
        { backend: "shell", encoding: "utf8" }
      );
      const result = await handle.result();
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr || `move failed with exit ${result.exitCode}`
        );
      }
      return { from: normalizedFrom, to: normalizedTo, recursive };
    }
  });

  tools.copy = tool({
    description: "Copy a file or directory inside the workspace.",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      recursive: z.boolean().optional()
    }),
    execute: async ({ from, to, recursive }) => {
      const normalizedFrom = normalizeWorkspacePath(from);
      const normalizedTo = normalizeWorkspacePath(to);
      const recursiveFlag = recursive ?? true;
      assertNotCorePath(normalizedTo);
      const ws = getWorkspace();
      const handle = await ws.runtime.exec(
        `cp${recursiveFlag ? " -r" : ""} ${quoteExecPath(normalizedFrom)} ${quoteExecPath(normalizedTo)}`,
        { backend: "shell", encoding: "utf8" }
      );
      const result = await handle.result();
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr || `copy failed with exit ${result.exitCode}`
        );
      }
      return { from: normalizedFrom, to: normalizedTo, recursive: recursiveFlag };
    }
  });

  tools.todo_write = createTodoWriteTool({ setActivePlan });

  return tools;
}
