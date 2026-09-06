import { getAgentByName, routeAgentRequest } from "agents";
import type { Agent } from "agents";
import { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";
import channelModules from "virtual:crazp/channels";
import { handleFrameworkRequest } from "../worker";
import { shouldTryCustomChannelRequest } from "../agent/custom-channels";

export * from "virtual:crazp/agent-classes";
export { CodemodeRuntime } from "@cloudflare/codemode";
export { Sandbox } from "@cloudflare/sandbox";
export { ThinkMessengerStateAgent };

/** Stable root instance for messenger webhooks (Think fans out conversations). */
const MESSENGER_ROOT_INSTANCE = "default";

function resolveRootAgentNamespace(
  env: Record<string, unknown>
): DurableObjectNamespace<Agent> | null {
  for (const [key, value] of Object.entries(env)) {
    if (
      key.startsWith("ThinkAgent_") &&
      value &&
      typeof value === "object" &&
      "idFromName" in value
    ) {
      return value as DurableObjectNamespace<Agent>;
    }
  }
  return null;
}

export default {
  async fetch(
    request: Request,
    env: unknown,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const frameworkResponse = await handleFrameworkRequest(request);
    if (frameworkResponse) return frameworkResponse;

    const { pathname } = new URL(request.url);
    const namespace = resolveRootAgentNamespace(env as Record<string, unknown>);

    if (pathname.startsWith("/messengers/")) {
      if (!namespace) {
        return new Response("Agent binding not found", { status: 500 });
      }
      const stub = await getAgentByName(namespace, MESSENGER_ROOT_INSTANCE);
      return stub.fetch(request);
    }

    if (shouldTryCustomChannelRequest(pathname, channelModules)) {
      if (!namespace) {
        return new Response("Agent binding not found", { status: 500 });
      }
      const stub = await getAgentByName(namespace, MESSENGER_ROOT_INSTANCE);
      return stub.fetch(request);
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;

    if (namespace) {
      const stub = await getAgentByName(namespace, MESSENGER_ROOT_INSTANCE);
      const custom = await stub.fetch(request);
      if (custom.status !== 404) return custom;
    }

    return new Response("Not found", { status: 404 });
  }
};
