import { basename, extname } from "node:path";

import { DEFAULT_EXECUTION, DEFAULT_MODEL } from "../defaults";
import {
  buildSourceFileMap,
  evaluateConfigModule,
  normalizePath
} from "./bundle";
import { buildSkillsBundleFromFiles, mergeSkillsBundles } from "./skills";
import type { CrazpAgentConfig, CrazpSubagentConfig } from "crazp";
import type {
  CrazpAgentManifest,
  CrazpDiscoveredTool,
  CrazpResolvedSubagentConfig
} from "../types";

export type SourceFile = {
  path: string;
  content: string;
};

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export type DiscoverAgentFromFilesOptions = {
  agentDir?: string;
};

export async function discoverAgentFromFiles(
  files: SourceFile[],
  options: DiscoverAgentFromFilesOptions = {}
): Promise<CrazpAgentManifest> {
  const agentDirName = options.agentDir ?? "agent";
  const rootDir = ".";
  const fileMap = buildSourceFileMap(files);
  const agentPrefix = `${normalizePath(agentDirName)}/`;

  const instructions = readIndexedText(
    fileMap,
    `${agentPrefix}instructions.md`
  );
  const agentConfigPath = `${agentPrefix}agent.ts`;
  const config = await loadRequiredIndexedConfig<CrazpAgentConfig>(
    fileMap,
    agentConfigPath
  );
  const tools = mergeDiscoveredTools(
    discoverIndexedToolFiles(fileMap, `${agentPrefix}tools`),
    discoverInlineTools(config.tools, agentConfigPath)
  );
  const skills = mergeSkillsBundles(
    buildSkillsBundleFromFiles(fileMap, `${agentPrefix}skills`, agentDirName),
    config?.skills ?? []
  );
  const subagents = await loadIndexedSubagents(
    fileMap,
    `${agentPrefix}subagents`
  );

  return {
    rootDir,
    agentDir: agentDirName,
    name: config?.name ?? basename(agentDirName),
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

function readIndexedText(
  fileMap: Map<string, string>,
  path: string
): string | null {
  return fileMap.get(normalizePath(path)) ?? null;
}

async function loadRequiredIndexedConfig<T>(
  fileMap: Map<string, string>,
  path: string
): Promise<T> {
  const config = await loadOptionalIndexedConfig<T>(fileMap, path);
  if (!config) {
    throw new Error(`Required config file "${path}" is missing`);
  }
  return config;
}

async function loadOptionalIndexedConfig<T>(
  fileMap: Map<string, string>,
  path: string
): Promise<T | null> {
  const normalized = normalizePath(path);
  if (!fileMap.has(normalized)) return null;
  return (await evaluateConfigModule(normalized, fileMap)) as T | null;
}

function discoverIndexedToolFiles(
  fileMap: Map<string, string>,
  dir: string
): CrazpDiscoveredTool[] {
  const prefix = `${normalizePath(dir)}/`;
  const tools: CrazpDiscoveredTool[] = [];
  const seen = new Set<string>();

  for (const path of fileMap.keys()) {
    if (!path.startsWith(prefix) || extname(path) !== ".ts") continue;
    const relative = path.slice(prefix.length);
    if (relative.includes("/")) continue;

    const name = basename(path, ".ts");
    if (!TOOL_NAME_RE.test(name)) {
      throw new Error(
        `Invalid tool filename "${relative}". Use lower_snake_case TypeScript files.`
      );
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate tool name discovered: ${name}`);
    }
    seen.add(name);
    tools.push({ name, path });
  }

  return tools;
}

async function loadIndexedSubagents(
  fileMap: Map<string, string>,
  dir: string
): Promise<Record<string, CrazpResolvedSubagentConfig>> {
  const prefix = `${normalizePath(dir)}/`;
  const subagentKeys = new Set<string>();

  for (const path of fileMap.keys()) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const key = relative.split("/")[0];
    if (key) subagentKeys.add(key);
  }

  const subagents: Record<string, CrazpResolvedSubagentConfig> = {};
  for (const key of subagentKeys) {
    const subagentDir = `${normalizePath(dir)}/${key}`;
    const instructions = readIndexedText(
      fileMap,
      `${subagentDir}/instructions.md`
    );
    const subagentConfigPath = `${subagentDir}/agent.ts`;
    const config = await loadRequiredIndexedConfig<CrazpSubagentConfig>(
      fileMap,
      subagentConfigPath
    );
    const tools = mergeDiscoveredTools(
      discoverIndexedToolFiles(fileMap, `${subagentDir}/tools`),
      discoverInlineTools(config.tools, subagentConfigPath)
    );

    if (!instructions && tools.length === 0) continue;
    subagents[key] = {
      displayName: config?.displayName ?? titleCase(key),
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
        displayName: config.displayName ?? titleCase(key),
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
