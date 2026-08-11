import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  compileSkillScript,
  isCompilableSkillScript
} from "agents/skills/compile";
import { parse } from "yaml";
import type { SkillManifest, SkillManifestEntry } from "agents/skills";

const SKILL_RESOURCE_ROOTS = new Set([
  "references",
  "scripts",
  "assets",
  "graphics",
  "fonts",
  "templates",
  "rendered-files",
  "illustrations"
]);

const SKILL_IGNORED_ROOTS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "coverage",
  "node_modules"
]);

const SPEC_RESOURCE_ROOTS = new Set(["references", "scripts", "assets"]);

const SKILL_ASSET_WARN_BYTES = 256 * 1024;
const SKILL_BUNDLE_WARN_BYTES = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

const MIME_TYPES = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".py", "text/x-python"],
  [".sh", "text/x-shellscript"],
  [".svg", "image/svg+xml"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"]
]);

export type BuildSkillsBundleOptions = {
  warn?: (message: string) => void;
};

export function buildSkillsBundleFromFiles(
  files: Map<string, string>,
  dir: string,
  bundleName = basename(dir),
  options: BuildSkillsBundleOptions = {}
): SkillManifest {
  const warn = options.warn ?? ((message) => console.warn(message));
  const prefix = `${normalizeSkillsPrefix(dir)}/`;
  const skillNames = new Set<string>();

  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const skillName = relative.split("/")[0];
    if (skillName) skillNames.add(skillName);
  }

  const skills: SkillManifestEntry[] = [];
  const seen = new Set<string>();

  for (const skillDirName of [...skillNames].sort((a, b) =>
    a.localeCompare(b, "en")
  )) {
    const skill = readSkillFromFiles(files, `${prefix}${skillDirName}`, warn);
    if (!skill) continue;
    if (seen.has(skill.name)) {
      warn(
        `Duplicate bundled skill name "${skill.name}" in "${skillDirName}/"; keeping the first occurrence and ignoring this one.`
      );
      continue;
    }
    seen.add(skill.name);
    skills.push(skill);
  }

  let totalBytes = 0;
  for (const skill of skills) {
    for (const resource of skill.resources ?? []) {
      const size = resource.size ?? 0;
      totalBytes += size;
      if (size > SKILL_ASSET_WARN_BYTES) {
        warn(
          `Bundled skill resource "${skill.name}/${resource.path}" is ${formatBytes(size)}; large assets bloat the Worker bundle (base64, ~1.33x). Prefer an R2-backed source via skills.r2().`
        );
      }
    }
  }
  if (totalBytes > SKILL_BUNDLE_WARN_BYTES) {
    warn(
      `Bundled skills total ${formatBytes(totalBytes)} of embedded resources; this competes with the Worker bundle-size budget. Consider serving large skills from R2 via skills.r2().`
    );
  }

  const hash = createHash("sha256");
  hash.update(JSON.stringify(skills));

  return {
    id: `bundle:${bundleName}`,
    fingerprint: hash.digest("hex"),
    skills
  };
}

function normalizeSkillsPrefix(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function readSkillFromFiles(
  files: Map<string, string>,
  skillPrefix: string,
  warn: (message: string) => void
): SkillManifestEntry | null {
  const rawContent = files.get(`${skillPrefix}/SKILL.md`) ?? null;
  if (rawContent === null) return null;

  const { data, body } = parseFrontmatter(rawContent);
  const name = stringField(data.name);
  const description = stringField(data.description);
  if (!name || !description) return null;

  const resources = collectFilesFromMap(files, skillPrefix, warn).map(
    (file) => {
      const encoding = resourceEncoding(file.path);
      const kind = resourceKind(file.path);
      const content = file.content;
      const size = Buffer.byteLength(
        content,
        encoding === "base64" ? "base64" : "utf8"
      );

      return {
        path: file.path,
        kind,
        size,
        encoding,
        mimeType: resourceMimeType(file.path),
        content,
        precompiled: false
      };
    }
  );

  return {
    name,
    description,
    body,
    rawContent,
    compatibility: stringField(data.compatibility),
    license: stringField(data.license),
    allowedTools: stringField(data["allowed-tools"]),
    metadata: recordField(data.metadata),
    resources
  };
}

function collectFilesFromMap(
  files: Map<string, string>,
  skillPrefix: string,
  warn: (message: string) => void
): Array<{ path: string; content: string }> {
  const prefix = `${skillPrefix}/`;
  const collected: Array<{ path: string; content: string }> = [];

  for (const [path, content] of files.entries()) {
    if (!path.startsWith(prefix) || path === `${skillPrefix}/SKILL.md`)
      continue;

    const relativePath = path.slice(prefix.length);
    const resourceRoot = relativePath.split("/")[0];
    if (!resourceRoot || SKILL_IGNORED_ROOTS.has(resourceRoot)) continue;
    if (!SKILL_RESOURCE_ROOTS.has(resourceRoot)) {
      warn(
        `Ignoring skill file "${relativePath}". Bundled skill resources should live under references/, scripts/, assets/, or a known asset root.`
      );
      continue;
    }
    if (!SPEC_RESOURCE_ROOTS.has(resourceRoot)) {
      warn(
        `Bundling non-standard skill resource root "${resourceRoot}/". Prefer assets/ for portable Agent Skills when possible.`
      );
    }

    collected.push({ path: relativePath, content });
  }

  return collected.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export async function buildSkillsBundle(
  dir: string,
  options: BuildSkillsBundleOptions = {}
): Promise<SkillManifest> {
  const warn = options.warn ?? ((message) => console.warn(message));
  if (!(await exists(dir))) {
    return emptySkillsBundle(basename(dir));
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const skills: SkillManifestEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = await readSkill(join(dir, entry.name), warn);
    if (!skill) continue;
    if (seen.has(skill.name)) {
      warn(
        `Duplicate bundled skill name "${skill.name}" in "${entry.name}/"; keeping the first occurrence and ignoring this one.`
      );
      continue;
    }
    seen.add(skill.name);
    skills.push(skill);
  }

  skills.sort((a, b) => a.name.localeCompare(b.name, "en"));

  let totalBytes = 0;
  for (const skill of skills) {
    for (const resource of skill.resources ?? []) {
      const size = resource.size ?? 0;
      totalBytes += size;
      if (size > SKILL_ASSET_WARN_BYTES) {
        warn(
          `Bundled skill resource "${skill.name}/${resource.path}" is ${formatBytes(size)}; large assets bloat the Worker bundle (base64, ~1.33x). Prefer an R2-backed source via skills.r2().`
        );
      }
    }
  }
  if (totalBytes > SKILL_BUNDLE_WARN_BYTES) {
    warn(
      `Bundled skills total ${formatBytes(totalBytes)} of embedded resources; this competes with the Worker bundle-size budget. Consider serving large skills from R2 via skills.r2().`
    );
  }

  const hash = createHash("sha256");
  hash.update(JSON.stringify(skills));

  return {
    id: `bundle:${basename(dir)}`,
    fingerprint: hash.digest("hex"),
    skills
  };
}

export function mergeSkillsBundles(
  bundle: SkillManifest,
  extra: SkillManifestEntry[]
): SkillManifest {
  if (extra.length === 0) return bundle;

  const seen = new Set(bundle.skills.map((skill) => skill.name));
  const skills = [...bundle.skills];
  for (const skill of extra) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const hash = createHash("sha256");
  hash.update(JSON.stringify(skills));

  return {
    id: bundle.id,
    fingerprint: hash.digest("hex"),
    skills
  };
}

async function readSkill(
  skillDir: string,
  warn: (message: string) => void
): Promise<SkillManifestEntry | null> {
  const rawContent = await readFile(join(skillDir, "SKILL.md"), "utf8").catch(
    () => null
  );
  if (rawContent === null) return null;

  const { data, body } = parseFrontmatter(rawContent);
  const name = stringField(data.name);
  const description = stringField(data.description);
  if (!name || !description) return null;

  const resources = await Promise.all(
    (await collectFiles(skillDir, "", warn)).map(async (file) => {
      const encoding = resourceEncoding(file.path);
      const bytes = await readFile(file.absolutePath);
      const kind = resourceKind(file.path);
      let content =
        encoding === "base64" ? bytes.toString("base64") : bytes.toString();
      let precompiled = false;
      let size = file.size;

      if (
        kind === "script" &&
        encoding === "text" &&
        isCompilableSkillScript(file.path)
      ) {
        try {
          content = (await compileSkillScript(file.absolutePath)).content;
          precompiled = true;
          size = Buffer.byteLength(content);
        } catch (error) {
          warn(
            `Failed to compile skill script "${file.path}": ${
              error instanceof Error ? error.message : String(error)
            }. Skill scripts must be self-contained, compilable modules to run at runtime.`
          );
        }
      }

      return {
        path: file.path,
        kind,
        size,
        encoding,
        mimeType: resourceMimeType(file.path),
        content,
        precompiled
      };
    })
  );

  return {
    name,
    description,
    body,
    rawContent,
    compatibility: stringField(data.compatibility),
    license: stringField(data.license),
    allowedTools: stringField(data["allowed-tools"]),
    metadata: recordField(data.metadata),
    resources
  };
}

async function collectFiles(
  root: string,
  relativeRoot = "",
  warn: (message: string) => void
): Promise<Array<{ path: string; absolutePath: string; size: number }>> {
  const entries = await readdir(join(root, relativeRoot), {
    withFileTypes: true
  }).catch(() => []);
  const files: Array<{ path: string; absolutePath: string; size: number }> = [];

  for (const entry of entries) {
    if (SKILL_IGNORED_ROOTS.has(entry.name)) continue;
    const relativePath = relativeRoot
      ? `${relativeRoot}/${entry.name}`
      : entry.name;
    const absolutePath = join(root, relativePath);

    if (entry.isDirectory()) {
      const resourceRoot = relativePath.split("/")[0];
      if (!resourceRoot || SKILL_IGNORED_ROOTS.has(resourceRoot)) continue;
      if (!SKILL_RESOURCE_ROOTS.has(resourceRoot)) {
        if (!relativeRoot) {
          warn(
            `Ignoring skill directory "${relativePath}". Bundled skill resources should live under references/, scripts/, assets/, or a known asset root.`
          );
        }
        continue;
      }
      if (!SPEC_RESOURCE_ROOTS.has(resourceRoot) && !relativeRoot) {
        warn(
          `Bundling non-standard skill resource root "${resourceRoot}/". Prefer assets/ for portable Agent Skills when possible.`
        );
      }
      files.push(...(await collectFiles(root, relativePath, warn)));
    } else if (entry.isFile() && relativePath !== "SKILL.md") {
      const resourceRoot = relativePath.split("/")[0];
      if (!resourceRoot || SKILL_IGNORED_ROOTS.has(resourceRoot)) continue;
      if (!SKILL_RESOURCE_ROOTS.has(resourceRoot)) {
        warn(
          `Ignoring skill file "${relativePath}". Bundled skill resources should live under references/, scripts/, assets/, or a known asset root.`
        );
        continue;
      }
      const info = await stat(absolutePath);
      files.push({
        path: relativePath,
        absolutePath,
        size: info.size
      });
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const parsed = parse(match[1] ?? "");
  return {
    data:
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    body: match[2] ?? ""
  };
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordField(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resourceKind(path: string): "reference" | "script" | "asset" | "file" {
  if (path.startsWith("references/")) return "reference";
  if (path.startsWith("scripts/")) return "script";
  if (
    path.startsWith("assets/") ||
    path.startsWith("graphics/") ||
    path.startsWith("fonts/") ||
    path.startsWith("templates/") ||
    path.startsWith("rendered-files/") ||
    path.startsWith("illustrations/")
  ) {
    return "asset";
  }
  return "file";
}

function extensionOf(path: string) {
  const file = path.split("/").at(-1) ?? path;
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index).toLowerCase();
}

function resourceEncoding(path: string): "text" | "base64" {
  return TEXT_EXTENSIONS.has(extensionOf(path)) ? "text" : "base64";
}

function resourceMimeType(path: string) {
  return MIME_TYPES.get(extensionOf(path));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

export function createEmptySkillsBundle(dirName: string): SkillManifest {
  return emptySkillsBundle(dirName);
}

function emptySkillsBundle(dirName: string): SkillManifest {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([]));
  return {
    id: `bundle:${dirName}`,
    fingerprint: hash.digest("hex"),
    skills: []
  };
}

const exists = (path: string) =>
  stat(path)
    .then(() => true)
    .catch(() => false);
