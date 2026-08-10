import type { CrazpRouteConfig } from "../types";
import { json } from "./http";
import { handleFilesRequest } from "./handlers/files";
import { handleSkillsRequest } from "./handlers/skills";

export function createCrazpFetchHandler<Env>(config: CrazpRouteConfig<Env>) {
  return async function fetchCrazpApi(
    request: Request,
    env: Env
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env, config);
    }

    if (url.pathname === "/api/skills") {
      return handleSkillsRequest(request, env, config);
    }
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    return null;
  };
}
