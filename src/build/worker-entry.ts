import thinkEntry from "virtual:think/entry";
import { handleFrameworkRequest } from "../worker";

export * from "virtual:think/agents";
export { CodemodeRuntime } from "@cloudflare/think/server-entry";
export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext
  ): Promise<Response> {
    const frameworkResponse = await handleFrameworkRequest(request);
    if (frameworkResponse) return frameworkResponse;
    return thinkEntry.fetch(request, env, ctx);
  }
};
