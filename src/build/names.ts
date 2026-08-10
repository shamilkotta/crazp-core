export function toPascalCase(value: string): string {
  return value
    .split(/[-_\s]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

export function toThinkClassName(agentName: string): string {
  return `ThinkAgent_${toPascalCase(agentName)}`;
}

export function toThinkSubagentClassName(
  agentName: string,
  subagentName: string
): string {
  return `ThinkSubAgent_${toPascalCase(agentName)}_${toPascalCase(subagentName)}`;
}
