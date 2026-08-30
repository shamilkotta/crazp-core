import { routeAgentRequest } from "agents";
import { WorkspaceProxy, WorkspaceServiceProxy } from "@cloudflare/computer";
import { handleFrameworkRequest } from "../worker";

export * from "virtual:crazp/agent-classes";
export { WorkspaceProxy, WorkspaceServiceProxy };

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
