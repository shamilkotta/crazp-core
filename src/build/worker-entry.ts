import { routeAgentRequest } from "agents";
import { handleFrameworkRequest } from "../worker";

export * from "virtual:crazp/agent-classes";
export { CodemodeRuntime } from "@cloudflare/codemode";
export { Sandbox } from "@cloudflare/sandbox";

export default {
  async fetch(
    request: Request,
    env: unknown,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const frameworkResponse = await handleFrameworkRequest(request);
    if (frameworkResponse) return frameworkResponse;
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  }
};
