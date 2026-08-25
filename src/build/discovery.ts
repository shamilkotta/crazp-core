import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { DEFAULT_EXECUTION, DEFAULT_MODEL } from "../defaults";
import { evaluateConfigModuleFromFileSystem, normalizePath } from "./bundle";
import { buildSkillsBundle, mergeSkillsBundles } from "./skills";
import type { CrazpAgentConfig, CrazpSubagentConfig } from "crazp";
import type {
  CrazpAgentManifest,
  CrazpDiscoveredTool,
  CrazpResolvedSubagentConfig
} from "../types";
import { slugify } from "../lib";

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export type DiscoverAgentFromProjectOptions = {
  projectRoot: string;
  agentDir?: string;
};

export async function discoverAgentFromProject(
  options: DiscoverAgentFromProjectOptions
): Promise<CrazpAgentManifest> {
  const agentDirName = options.agentDir ?? "agent";
  const rootDir = options.projectRoot;
  const agentPrefix = normalizePath(agentDirName);
  const agentRoot = join(rootDir, agentPrefix);

  const instructions = await readProjectText(
    rootDir,
    `${agentPrefix}/instructions.md`
  );
  const agentConfigPath = `${agentPrefix}/agent.ts`;
  const config = await loadRequiredProjectConfig<CrazpAgentConfig>(
    rootDir,
    agentConfigPath
  );
  const tools = mergeDiscoveredTools(
    await discoverProjectToolFiles(rootDir, `${agentPrefix}/tools`),
    discoverInlineTools(config.tools, agentConfigPath)
  );
  const skills = mergeSkillsBundles(
    await buildSkillsBundle(join(agentRoot, "skills")),
    config?.skills ?? []
  );
  const subagents = await loadProjectSubagents(
    rootDir,
    `${agentPrefix}/subagents`
  );

  return {
    rootDir,
    agentDir: agentDirName,
    name: config?.name ?? basename(rootDir),
    slug: config?.slug ?? slugify(config?.name ?? basename(rootDir)),
    model: config?.model ?? DEFAULT_MODEL,
    maxSteps: config?.maxSteps ?? 250,
    chatRecovery: config?.chatRecovery ?? true,
    instructions: instructions ?? config?.instructions ?? "",
    tools,
    subagents: {
      ...normalizeInlineSubagents(config?.subagents ?? {}),
      ...subagents
    },
    skills,
    extensions: config?.extensions ?? true,
    execution: { ...DEFAULT_EXECUTION, ...config?.execution }
  };
}

async function readProjectText(
  projectRoot: string,
  path: string
): Promise<string | null> {
  return readFile(join(projectRoot, normalizePath(path)), "utf8").catch(
    (error) => {
      if (isMissingPathError(error)) return null;
      throw error;
    }
  );
}

async function loadRequiredProjectConfig<T>(
  projectRoot: string,
  path: string
): Promise<T> {
  const config = await loadOptionalProjectConfig<T>(projectRoot, path);
  if (!config) {
    throw new Error(`Required config file "${path}" is missing`);
  }
  return config;
}

async function loadOptionalProjectConfig<T>(
  projectRoot: string,
  path: string
): Promise<T | null> {
  const normalized = normalizePath(path);
  if (!(await exists(join(projectRoot, normalized)))) return null;
  return (await evaluateConfigModuleFromFileSystem(
    normalized,
    projectRoot
  )) as T | null;
}

async function discoverProjectToolFiles(
  projectRoot: string,
  dir: string
): Promise<CrazpDiscoveredTool[]> {
  const normalizedDir = normalizePath(dir);
  const entries = await readdir(join(projectRoot, normalizedDir), {
    withFileTypes: true
  }).catch((error) => {
    if (isMissingPathError(error)) return [];
    throw error;
  });
  const tools: CrazpDiscoveredTool[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".ts") continue;

    const name = basename(entry.name, ".ts");
    if (!TOOL_NAME_RE.test(name)) {
      throw new Error(
        `Invalid tool filename "${entry.name}". Use lower_snake_case TypeScript files.`
      );
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate tool name discovered: ${name}`);
    }
    seen.add(name);
    tools.push({ name, path: `${normalizedDir}/${entry.name}` });
  }

  return tools;
}

// TODO: SKILLS?
async function loadProjectSubagents(
  projectRoot: string,
  dir: string
): Promise<Record<string, CrazpResolvedSubagentConfig>> {
  const prefix = normalizePath(dir);
  const entries = await readdir(join(projectRoot, prefix), {
    withFileTypes: true
  }).catch((error) => {
    if (isMissingPathError(error)) return [];
    throw error;
  });
  const subagents: Record<string, CrazpResolvedSubagentConfig> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const key = entry.name;
    const subagentDir = `${prefix}/${key}`;
    const instructions = await readProjectText(
      projectRoot,
      `${subagentDir}/instructions.md`
    );
    const subagentConfigPath = `${subagentDir}/agent.ts`;
    const config = await loadRequiredProjectConfig<CrazpSubagentConfig>(
      projectRoot,
      subagentConfigPath
    );
    const tools = mergeDiscoveredTools(
      await discoverProjectToolFiles(projectRoot, `${subagentDir}/tools`),
      discoverInlineTools(config.tools, subagentConfigPath)
    );

    if (!instructions && tools.length === 0) continue;
    subagents[key] = {
      name: config?.name ?? titleCase(key),
      slug: config?.slug ?? slugify(config?.name ?? titleCase(key)),
      description: config?.description ?? `${titleCase(key)} subagent`,
      model: config?.model ?? DEFAULT_MODEL,
      maxSteps: config?.maxSteps ?? 250,
      instructions: config?.instructions ?? instructions ?? "",
      tools
    };
  }

  return subagents;
}

function normalizeInlineSubagents(
  subagents: CrazpAgentConfig["subagents"]
): Record<string, CrazpResolvedSubagentConfig> {
  return Object.fromEntries(
    Object.entries(subagents!).map(([key, config]) => [
      key,
      {
        name: config.name ?? titleCase(key),
        slug: config.slug ?? slugify(config.name ?? titleCase(key)),
        description: config.description ?? `${titleCase(key)} subagent`,
        model: config.model ?? DEFAULT_MODEL,
        maxSteps: config.maxSteps ?? 250,
        instructions: config.instructions ?? "",
        tools: []
      }
    ])
  );
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function discoverInlineTools(
  tools: CrazpAgentConfig["tools"] | CrazpSubagentConfig["tools"],
  configPath: string,
  accessPrefix = "tools"
): CrazpDiscoveredTool[] {
  if (!tools) return [];

  return Object.keys(tools).map((name) => {
    if (!TOOL_NAME_RE.test(name)) {
      throw new Error(
        `Invalid inline tool name "${name}". Use lower_snake_case names.`
      );
    }
    return {
      name,
      configPath,
      configAccess: `${accessPrefix}.${name}`
    };
  });
}

function mergeDiscoveredTools(
  fileTools: CrazpDiscoveredTool[],
  inlineTools: CrazpDiscoveredTool[]
): CrazpDiscoveredTool[] {
  const merged = [...fileTools, ...inlineTools];
  const seen = new Set<string>();

  for (const tool of merged) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name discovered: ${tool.name}`);
    }
    seen.add(tool.name);
  }

  return merged;
}

const exists = (path: string) =>
  stat(path)
    .then(() => true)
    .catch((error) => {
      if (isMissingPathError(error)) return false;
      throw error;
    });

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
