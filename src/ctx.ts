import type { CrazpContext } from "crazp";

let current: CrazpContext | null = null;

export function setCrazpContext(ctx: CrazpContext) {
  current = ctx;
}

export function clearCrazpContext() {
  current = null;
}

function requireContext() {
  if (current == null) {
    throw new Error(
      "crazp:ctx is only available while a user-defined tool is executing"
    );
  }
  return current;
}

const crazpCtx: CrazpContext = {
  get env() {
    return requireContext().env;
  },
  get ctx() {
    return requireContext().ctx;
  },
  get workspace() {
    return requireContext().workspace;
  },
  get agentName() {
    return requireContext().agentName;
  }
};

export default crazpCtx;
