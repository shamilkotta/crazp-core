import type { SkillManifest, SkillManifestEntry } from "agents/skills";
import type { CrazpAgentConfig, CrazpSubagentConfig } from "crazp";

export type CrazpDiscoveredTool = {
  name: string;
  /** Absolute or virtual path to the tool file. */
  path?: string;
  /** Path to the config module that defines an inline tool. */
  configPath?: string;
  /** Dot-separated path on the config default export. Defaults to `tools.<name>`. */
  configAccess?: string;
};

export type CrazpResolvedSubagentConfig = Required<
  Omit<CrazpSubagentConfig, "instructions" | "tools">
> & {
  instructions: string;
  tools: CrazpDiscoveredTool[];
};

export type CrazpResolvedAgentConfig = Required<
  Omit<CrazpAgentConfig, "instructions" | "tools">
> & {
  instructions: string;
  tools: CrazpDiscoveredTool[];
};

export type CrazpAgentManifest = Omit<
  CrazpResolvedAgentConfig,
  "skills" | "subagents"
> & {
  rootDir: string;
  agentDir: string;
  skills: SkillManifest;
  subagents: Record<string, CrazpResolvedSubagentConfig>;
};

export type CrazpRouteConfig<Env = unknown> = {
  getAgentStub: (env: Env, instanceName?: string) => Promise<CrazpAgentStub>;
  defaultInstanceName?: string;
  devReset?: boolean;
};

export type CrazpAgentStub = DurableObjectStub & {
  startBootstrapIfPending(): Promise<{ started: boolean }>;
  devReset(): Promise<void>;
  listCoreFiles(): Promise<unknown[]>;
  readCoreFile(path: string): Promise<unknown | null>;
  writeCoreFile(path: string, content: string): Promise<void>;
  listAgentSkills(): Promise<unknown[]>;
};

export type { SkillManifest, SkillManifestEntry };
