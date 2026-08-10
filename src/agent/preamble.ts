import type { ActivePlan } from "./tools/todo";

const STATUS_GLYPH: Record<
  "completed" | "in_progress" | "cancelled" | "pending",
  string
> = {
  completed: "[x]",
  in_progress: "[→]",
  cancelled: "[~]",
  pending: "[ ]"
};

function renderActivePlanSection(plan: ActivePlan | null): string | null {
  if (!plan || plan.todos.length === 0) return null;
  const lines = plan.todos.map(
    (t) => `- ${STATUS_GLYPH[t.status]} ${t.content}`
  );
  return [
    "## Active plan",
    "Your current `todo_write` checklist (latest call wins).",
    ...lines
  ].join("\n");
}

export function buildTurnSections(args: {
  bootstrap: string | null;
  latestPlan: ActivePlan | null;
}): string {
  const sections: string[] = [];
  if (args.bootstrap != null) {
    sections.push(
      `## BOOTSTRAP (first-run ritual — active)\nA bootstrap file is present. Run its ritual before anything else.\n\n---\n${args.bootstrap.trim()}`
    );
  }
  const planSection = renderActivePlanSection(args.latestPlan);
  if (planSection) sections.push(planSection);
  const today = new Date().toISOString().slice(0, 10);
  sections.push(`## Environment\nToday: ${today}`);
  return sections.join("\n\n");
}
