import type { CrazpAgentManifest, CrazpDiscoveredTool } from "../types";
import type { SerializedCrazpManifest } from "../agent/types";
import {
  toPascalCase,
  toThinkClassName,
  toThinkSubagentClassName
} from "./names";

export type VirtualBuildContext = {
  modules: Map<string, string>;
};

const VIRTUAL_PREFIX = "\0";

export function toVirtualId(id: string): string {
  return id.startsWith(VIRTUAL_PREFIX) ? id : `${VIRTUAL_PREFIX}${id}`;
}

export function buildVirtualModules(
  manifest: CrazpAgentManifest
): VirtualBuildContext {
  const serialized = serializeManifest(manifest);
  const agentId = manifest.name;
  const agentFiles: Record<string, string> = {};
  const classExports: { className: string; virtualId: string }[] = [];

  const workerImports: string[] = [];
  const workerBindings: string[] = [];

  for (const subagentKey of Object.keys(manifest.subagents)) {
    const className = toThinkSubagentClassName(agentId, subagentKey);
    const importName = `${toPascalCase(subagentKey)}Worker`;
    const sourcePath = `agents/${agentId}/agents/${subagentKey}/agent.ts`;
    const virtualId = `virtual:crazp/${sourcePath.replace(/\.ts$/, "")}`;
    workerImports.push(
      `import { ${className} as ${importName} } from ${JSON.stringify(virtualId)};`
    );
    workerBindings.push(`  ${JSON.stringify(subagentKey)}: ${importName}`);
    agentFiles[sourcePath] = renderSubagentAgentFile({
      className,
      subagentKey
    });
    classExports.push({ className, virtualId });
  }

  const mainClassName = toThinkClassName(agentId);
  const mainSourcePath = `agents/${agentId}/agent.ts`;
  const mainVirtualId = `virtual:crazp/${mainSourcePath.replace(/\.ts$/, "")}`;
  agentFiles[mainSourcePath] = renderMainAgentFile({
    className: mainClassName,
    workerImports,
    workerBindings
  });
  classExports.unshift({ className: mainClassName, virtualId: mainVirtualId });

  const modules = new Map<string, string>();

  modules.set(
    toVirtualId("virtual:crazp/manifest"),
    `export default ${JSON.stringify(serialized, null, 2)};`
  );
  modules.set(
    toVirtualId("virtual:crazp/tools/agent"),
    renderToolsModule(manifest.tools)
  );
  modules.set(
    toVirtualId("virtual:crazp/tools/subagents"),
    renderSubagentToolsModule(manifest.subagents)
  );

  for (const [sourcePath, source] of Object.entries(agentFiles)) {
    const virtualAgentId = `virtual:crazp/${sourcePath.replace(/\.ts$/, "")}`;
    modules.set(toVirtualId(virtualAgentId), source);
    modules.set(toVirtualId(sourcePath), source);
  }

  modules.set(
    toVirtualId("virtual:crazp/agent-classes"),
    renderAgentClassesModule(classExports)
  );

  return { modules };
}

function serializeManifest(
  manifest: CrazpAgentManifest
): SerializedCrazpManifest {
  const { tools, subagents, ...rest } = manifest;
  return {
    ...rest,
    toolNames: tools.map((tool) => tool.name),
    subagents: Object.fromEntries(
      Object.entries(subagents).map(([key, value]) => {
        const { tools: subTools, ...subagent } = value;
        return [
          key,
          { ...subagent, toolNames: subTools.map((tool) => tool.name) }
        ];
      })
    )
  };
}

function renderToolsModule(tools: CrazpDiscoveredTool[]) {
  if (tools.length === 0) {
    return "export default {};";
  }

  const imports: string[] = [];
  const entries: string[] = [];
  const configImports = new Map<string, string>();
  let fileToolIndex = 0;

  for (const tool of tools) {
    if (tool.path) {
      const varName = `tool_${fileToolIndex++}`;
      imports.push(`import ${varName} from ${JSON.stringify(tool.path)};`);
      entries.push(`  ${JSON.stringify(tool.name)}: ${varName}`);
      continue;
    }

    if (!tool.configPath) continue;

    const importName = getConfigImportName(
      tool.configPath,
      configImports,
      imports
    );
    entries.push(
      `  ${JSON.stringify(tool.name)}: ${renderConfigAccess(importName, tool)}`
    );
  }

  return `${imports.join("\n")}

export default {
${entries.join(",\n")}
};
`;
}

function renderSubagentToolsModule(subagents: CrazpAgentManifest["subagents"]) {
  const entries = Object.entries(subagents).filter(
    ([, subagent]) => subagent.tools.length > 0
  );
  if (entries.length === 0) {
    return "export default {};";
  }

  const imports: string[] = [];
  const configImports = new Map<string, string>();
  const subagentEntries: string[] = [];
  let fileToolIndex = 0;

  for (const [key, subagent] of entries) {
    const toolEntries: string[] = [];

    for (const tool of subagent.tools) {
      if (tool.path) {
        const varName = `tool_${fileToolIndex++}`;
        imports.push(`import ${varName} from ${JSON.stringify(tool.path)};`);
        toolEntries.push(`    ${JSON.stringify(tool.name)}: ${varName}`);
        continue;
      }

      if (!tool.configPath) continue;

      const importName = getConfigImportName(
        tool.configPath,
        configImports,
        imports
      );
      toolEntries.push(
        `    ${JSON.stringify(tool.name)}: ${renderConfigAccess(importName, tool)}`
      );
    }

    subagentEntries.push(
      `  ${JSON.stringify(key)}: {\n${toolEntries.join(",\n")}\n  }`
    );
  }

  return `${imports.join("\n")}

export default {
${subagentEntries.join(",\n")}
};
`;
}

function getConfigImportName(
  configPath: string,
  configImports: Map<string, string>,
  imports: string[]
): string {
  const existing = configImports.get(configPath);
  if (existing) return existing;

  const importName = `config_${configImports.size}`;
  configImports.set(configPath, importName);
  imports.push(`import ${importName} from ${JSON.stringify(configPath)};`);
  return importName;
}

function renderConfigAccess(
  importName: string,
  tool: CrazpDiscoveredTool
): string {
  const access = tool.configAccess ?? `tools.${tool.name}`;
  return access
    .split(".")
    .reduce((expr, part) => `${expr}[${JSON.stringify(part)}]`, importName);
}

function renderSubagentAgentFile(args: {
  className: string;
  subagentKey: string;
}): string {
  return `import { createCrazpWorkerClass } from "@crazp/core/worker";
import manifest from "virtual:crazp/manifest";

export const ${args.className} = createCrazpWorkerClass(
  manifest,
  ${JSON.stringify(args.subagentKey)},
  ${JSON.stringify(args.className)}
);
export default ${args.className};
`;
}

function renderMainAgentFile(args: {
  className: string;
  workerImports: string[];
  workerBindings: string[];
}): string {
  return `import { createCrazpAgentClass } from "@crazp/core/worker";
import manifest from "virtual:crazp/manifest";
${args.workerImports.join("\n")}

const workerClasses = {
${args.workerBindings.join(",\n")}
};

export const ${args.className} = createCrazpAgentClass(
  manifest,
  ${JSON.stringify(args.className)},
  workerClasses
);
export default ${args.className};
`;
}

function renderAgentClassesModule(
  classExports: { className: string; virtualId: string }[]
): string {
  return classExports
    .map(
      ({ className, virtualId }) =>
        `export { ${className} } from ${JSON.stringify(virtualId)};`
    )
    .join("\n");
}
