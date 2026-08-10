import { json } from "../http";
import type { CrazpRouteConfig } from "../../types";

export async function handleSkillsRequest<Env>(
  request: Request,
  env: Env,
  config: CrazpRouteConfig<Env>
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const stub = await config.getAgentStub(env, config.defaultInstanceName);
  return json({ skills: await stub.listAgentSkills() });
}
