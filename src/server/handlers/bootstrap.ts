import { json } from "../http";
import type { CrazpRouteConfig } from "../../types";

function isDevHost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname.endsWith(".localhost");
}

export async function handleBootstrapRequest<Env>(
  request: Request,
  env: Env,
  config: CrazpRouteConfig<Env>
): Promise<Response> {
  const url = new URL(request.url);
  const stub = await config.getAgentStub(env, config.defaultInstanceName);

  if (url.pathname === "/api/bootstrap/start") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    return json(await stub.startBootstrapIfPending());
  }

  if (url.pathname === "/api/bootstrap/reset") {
    if (!config.devReset && !isDevHost(url)) {
      return json({ error: "Not found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    await stub.devReset();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}
