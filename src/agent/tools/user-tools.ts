import type { ToolSet } from "ai";

export function mergeUserTools(
  frameworkTools: ToolSet,
  userTools: ToolSet
): ToolSet {
  for (const name of Object.keys(userTools)) {
    if (name in frameworkTools) {
      throw new Error(
        `User tool "${name}" conflicts with a built-in framework tool`
      );
    }
  }
  return { ...frameworkTools, ...userTools };
}
