import type { Think } from "@cloudflare/think";
import type { MessageConcurrency } from "agents/chat";
import type {
  CrazpChannelModule,
  CrazpCustomChannelDefinition,
  CrazpRouteContext
} from "crazp/channels";
import { isCrazpCustomChannelDefinition } from "./channels";

type ResolvedCustomRoute = {
  channelId: string;
  definition: CrazpCustomChannelDefinition;
};

function collectCustomChannelRoutes(
  channelModules: Record<string, CrazpChannelModule>
): ResolvedCustomRoute[] {
  const routes: ResolvedCustomRoute[] = [];
  for (const [channelId, module] of Object.entries(channelModules)) {
    if (isCrazpCustomChannelDefinition(module)) {
      routes.push({ channelId, definition: module });
    }
  }
  return routes;
}

/** Mount custom routes under `/<channelFilename><route.path>`. */
function mountCustomChannelPath(channelId: string, routePath: string): string {
  const suffix = routePath.startsWith("/") ? routePath : `/${routePath}`;
  if (suffix === "/") return `/${channelId}`;
  return `/${channelId}${suffix}`;
}

function matchRoutePath(
  pathname: string,
  pattern: string
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const segment = patternParts[index]!;
    const value = pathParts[index]!;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (segment !== value) return null;
  }
  return params;
}

function applyCors(
  response: Response,
  cors: CrazpCustomChannelDefinition["cors"]
): Response {
  if (!cors) return response;
  const headers = new Headers(response.headers);
  if (cors === true) {
    headers.set("access-control-allow-origin", "*");
    headers.set(
      "access-control-allow-methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    headers.set("access-control-allow-headers", "authorization, content-type");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  const origin = cors.origin;
  if (origin) {
    headers.set(
      "access-control-allow-origin",
      Array.isArray(origin) ? origin.join(", ") : origin
    );
  }
  if (cors.methods?.length) {
    headers.set("access-control-allow-methods", cors.methods.join(", "));
  }
  if (cors.allowHeaders?.length) {
    headers.set("access-control-allow-headers", cors.allowHeaders.join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function toMessageConcurrency(
  turnPolicy?: "steer" | "queue"
): MessageConcurrency | undefined {
  if (turnPolicy === "steer") return "latest";
  if (turnPolicy === "queue") return "queue";
  return undefined;
}

function createChannelOps(
  agent: Think,
  channelId: string,
  address: string,
  turnPolicy?: "steer" | "queue"
) {
  const previousConcurrency = agent.messageConcurrency;
  const mapped = toMessageConcurrency(turnPolicy);
  if (mapped) {
    agent.messageConcurrency = mapped;
  }

  return {
    send: async (
      message: string,
      options?: { metadata?: Record<string, unknown> }
    ) => {
      await agent.runTurn({
        mode: "submit",
        channel: channelId,
        input: message,
        metadata: {
          ...(options?.metadata ?? {}),
          crazpAddress: address
        }
      });
      return { ok: true as const, status: "accepted" as const };
    },
    // TODO:
    cancel: async (_options?: { turnId?: string }) => {
      return { ok: false };
    },
    compact: async () => ({ ok: false }),
    clear: async () => ({ ok: false }),
    reset: async (_options?: { reason?: string }) => ({ ok: false }),
    restoreConcurrency: () => {
      agent.messageConcurrency = previousConcurrency;
    }
  };
}

export async function handleCustomChannelRequest(
  agent: Think,
  request: Request,
  channelModules: Record<string, CrazpChannelModule>,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<Response | null> {
  const url = new URL(request.url);
  const customChannels = collectCustomChannelRoutes(channelModules);
  if (customChannels.length === 0) return null;

  if (request.method === "OPTIONS") {
    for (const { definition } of customChannels) {
      if (definition.cors) {
        return applyCors(new Response(null, { status: 204 }), definition.cors);
      }
    }
  }

  for (const { channelId, definition } of customChannels) {
    for (const route of definition.routes) {
      if (route.method !== request.method) continue;
      const mounted = mountCustomChannelPath(channelId, route.path);
      const params = matchRoutePath(url.pathname, mounted);
      if (params == null) continue;

      const opsHolder = {
        restore: () => {}
      };
      const routeContext: CrazpRouteContext = {
        request,
        params,
        channelId,
        waitUntil,
        from: (address: string) => {
          const ops = createChannelOps(
            agent,
            channelId,
            address,
            definition.turnPolicy
          );
          opsHolder.restore = ops.restoreConcurrency;
          return ops;
        }
      };

      try {
        const response = await route.handler(request, routeContext);
        opsHolder.restore();
        return applyCors(response, definition.cors);
      } catch (error) {
        opsHolder.restore();
        const message =
          error instanceof Error ? error.message : "Custom channel failed";
        return applyCors(
          Response.json({ ok: false, error: message }, { status: 500 }),
          definition.cors
        );
      }
    }
  }

  return null;
}

export function shouldTryCustomChannelRequest(
  pathname: string,
  channelModules?: Record<string, CrazpChannelModule>
): boolean {
  if (channelModules) {
    return collectCustomChannelRoutes(channelModules).some(
      ({ channelId }) =>
        pathname === `/${channelId}` || pathname.startsWith(`/${channelId}/`)
    );
  }
  return pathname.startsWith("/crazp/") || pathname.startsWith("/channels/");
}
