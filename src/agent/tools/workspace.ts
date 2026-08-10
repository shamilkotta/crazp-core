import {
  createDeleteTool,
  createEditTool,
  createReadTool,
  createWriteTool
} from "@cloudflare/think/tools/workspace";
import type { Workspace } from "@cloudflare/shell";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { isCorePath } from "../core-files";
import type { ActivePlan } from "./todo";
import { createTodoWriteTool } from "./todo";

function assertNotCorePath(path: string): void {
  if (isCorePath(path)) {
    throw new Error(
      "Use set_context or identity file tools for core identity paths."
    );
  }
}

type BuildSharedToolSetOptions = {
  getWorkspace: () => Workspace;
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
};

export function buildSharedToolSet(
  options: BuildSharedToolSetOptions
): ToolSet {
  const { getWorkspace, setActivePlan } = options;
  return {
    read: createReadTool({
      ops: {
        readFile: async (path) => getWorkspace().readFile(path),
        readFileBytes: async (path) => getWorkspace().readFileBytes(path),
        stat: (path) => getWorkspace().stat(path)
      }
    }),
    write: createWriteTool({
      ops: {
        mkdir: async (path, opts) =>
          getWorkspace().mkdir(path, { recursive: opts?.recursive ?? true }),
        writeFile: async (path, content) => {
          assertNotCorePath(path);
          await getWorkspace().writeFile(path, content);
        }
      }
    }),
    edit: createEditTool({
      ops: {
        readFile: async (path) => getWorkspace().readFile(path),
        writeFile: async (path, content) => {
          assertNotCorePath(path);
          await getWorkspace().writeFile(path, content);
        }
      }
    }),
    delete: createDeleteTool({
      ops: {
        rm: async (path, opts) => {
          assertNotCorePath(path);
          await getWorkspace().rm(path, opts);
        }
      }
    }),
    move: tool({
      description: "Move or rename a file or directory inside the workspace.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        recursive: z.boolean().optional()
      }),
      execute: async ({ from, to, recursive }) => {
        assertNotCorePath(from);
        assertNotCorePath(to);
        await getWorkspace().mv(from, to, { recursive: recursive ?? true });
        return { from, to };
      }
    }),
    copy: tool({
      description: "Copy a file or directory inside the workspace.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        recursive: z.boolean().optional()
      }),
      execute: async ({ from, to, recursive }) => {
        assertNotCorePath(to);
        await getWorkspace().cp(from, to, { recursive: recursive ?? true });
        return { from, to };
      }
    }),
    todo_write: createTodoWriteTool({ setActivePlan })
  };
}
