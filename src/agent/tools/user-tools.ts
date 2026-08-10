import type { Tool, ToolSet } from "ai";

import { clearCrazpContext, setCrazpContext } from "../../ctx";
import type { CrazpContext } from "crazp";

type ExecutableTool = Tool & {
  execute?: (input: unknown, options: unknown) => unknown;
};

export function bindUserTools(
  tools: ToolSet,
  getContext: () => CrazpContext
): ToolSet {
  const bound: ToolSet = {};
  for (const [name, toolDef] of Object.entries(tools)) {
    bound[name] = bindToolContext(toolDef, getContext);
  }
  return bound;
}

function bindToolContext(toolDef: Tool, getContext: () => CrazpContext): Tool {
  const execute = (toolDef as ExecutableTool).execute;
  if (typeof execute !== "function") return toolDef;

  return {
    ...toolDef,
    execute: async (input, options) => {
      setCrazpContext(getContext());
      try {
        return await execute.call(toolDef, input, options);
      } finally {
        clearCrazpContext();
      }
    }
  };
}

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
