export type AgentNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

import type { CrazpAgentStub } from "../types";

export function getCrazpAgentStub<Env extends Record<string, unknown>>(
  env: Env,
  options?: {
    binding?: keyof Env & string;
    instanceName?: string;
  }
): Promise<CrazpAgentStub> {
  const binding = options?.binding ?? "CrazpAgent";
  const namespace = env[binding] as AgentNamespace | undefined;
  if (!namespace) {
    throw new Error(`Missing Durable Object binding: ${binding}`);
  }
  const id = namespace.idFromName(options?.instanceName ?? "default");
  return Promise.resolve(namespace.get(id) as CrazpAgentStub);
}
