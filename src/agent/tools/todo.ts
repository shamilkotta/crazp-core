import { tool, type Tool } from "ai";
import { z } from "zod";

const TodoItem = z.object({
  content: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"])
});

const inputSchema = z.object({
  todos: z.array(TodoItem)
});

export type TodoItemValue = z.infer<typeof TodoItem>;
export type ActivePlan = {
  todos: TodoItemValue[];
  updatedAt: number;
};

export function createTodoWriteTool({
  setActivePlan
}: {
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
}): Tool {
  return tool({
    description:
      "Maintain a per-turn checklist for multi-step work (3+ steps). Each call replaces the previous list.",
    inputSchema,
    execute: async ({ todos }) => {
      const inProgress = todos.filter((t) => t.status === "in_progress");
      if (inProgress.length > 1) {
        return {
          error: "Only one item may be 'in_progress' at a time.",
          todos
        };
      }
      const counts = {
        pending: todos.filter((t) => t.status === "pending").length,
        in_progress: inProgress.length,
        completed: todos.filter((t) => t.status === "completed").length,
        cancelled: todos.filter((t) => t.status === "cancelled").length
      };
      const allDone = counts.pending === 0 && counts.in_progress === 0;
      await setActivePlan(allDone ? null : { todos, updatedAt: Date.now() });
      return { todos, counts };
    }
  });
}
