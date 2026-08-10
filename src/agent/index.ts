import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/shell";
import { agentTool } from "agents/agent-tools";
import type {
  Session,
  WritableContextProvider
} from "agents/experimental/memory/session";
import { createCompactFunction } from "agents/experimental/memory/utils";
import { generateText, type ToolSet } from "ai";
import { z } from "zod";
import { fromManifest, r2 } from "agents/skills";
import agentUserTools from "virtual:crazp/tools/agent";
import subagentUserTools from "virtual:crazp/tools/subagents";

import { buildExecutionTools } from "./tools";
import { bindUserTools, mergeUserTools } from "./tools/user-tools";
import { buildTurnSections } from "./preamble";
import type { ActivePlan } from "./tools/todo";
import type { CrazpWorkerEnv, SerializedCrazpManifest } from "./types";
import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_SEED,
  coreFileMeta,
  IDENTITY_PATH,
  MEMORY_PATH,
  resolveCoreFile,
  SOUL_PATH,
  USER_PATH
} from "./core-files";

export function createCrazpWorkerClass(
  manifest: SerializedCrazpManifest,
  subagentKey: string,
  className: string
): new (ctx: DurableObjectState, env: CrazpWorkerEnv) => Think<CrazpWorkerEnv> {
  const subagent = manifest.subagents[subagentKey];
  if (!subagent) {
    throw new Error(`Unknown subagent: ${subagentKey}`);
  }

  class GeneratedWorker extends Think<CrazpWorkerEnv> {
    override extensionLoader = this.env.LOADER;
    override maxSteps = subagent.maxSteps;
    override workspace = new Workspace({
      sql: this.ctx.storage.sql,
      r2: this.env.WORKSPACE_BUCKET,
      name: () => this.name
    });

    override getModel() {
      return typeof subagent.model === "string"
        ? subagent.model
        : subagent.model({ env: this.env, agentName: this.name });
    }

    override configureSession(session: Session) {
      const compactFn = createCompactFunction({
        summarize: async (prompt) => {
          const result = await generateText({
            model: this.resolveModel(),
            prompt
          });
          return result.text;
        }
      });

      return session
        .withContext("operating", {
          provider: { get: async () => subagent.instructions }
        })
        .onCompaction(compactFn)
        .compactAfter(150_000)
        .withCachedPrompt();
    }

    override formatAgentToolInput(input: { brief?: string }) {
      const brief = input?.brief ?? JSON.stringify(input, null, 2);
      return {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: brief }]
      };
    }

    override getTools(): ToolSet {
      const frameworkTools = buildExecutionTools({
        executeAgent: this,
        ctx: this.ctx,
        agentName: this.name,
        env: this.env,
        getWorkspace: () => this.workspace,
        setActivePlan: (plan) => setActivePlan(this.ctx.storage, plan),
        execution: manifest.execution,
        extensions: manifest.extensions,
        extensionManager: this.extensionManager
      });
      const scopedTools = subagentUserTools[subagentKey] ?? {};
      const userTools = bindUserTools(scopedTools, () => ({
        env: this.env,
        ctx: this.ctx,
        workspace: this.workspace,
        agentName: this.name
      }));
      return mergeUserTools(frameworkTools, userTools);
    }
  }

  Object.defineProperty(GeneratedWorker, "name", { value: className });
  return GeneratedWorker;
}

export function createCrazpAgentClass(
  manifest: SerializedCrazpManifest,
  className: string,
  workerClasses: Record<string, ReturnType<typeof createCrazpWorkerClass>>
): new (ctx: DurableObjectState, env: CrazpWorkerEnv) => Think<CrazpWorkerEnv> {
  const BOOTSTRAP_SEEDED_KEY = "crazp:bootstrap-seeded" as const;

  class GeneratedAgent extends Think<CrazpWorkerEnv> {
    override extensionLoader = this.env.LOADER;
    override maxSteps = manifest.maxSteps;
    override chatRecovery = manifest.chatRecovery;
    override workspace = new Workspace({
      sql: this.ctx.storage.sql,
      r2: this.env.WORKSPACE_BUCKET,
      name: () => this.name
    });

    override getModel() {
      return typeof manifest.model === "string"
        ? manifest.model
        : manifest.model({ env: this.env, agentName: this.name });
    }

    override configureSession(session: Session) {
      const compactFn = createCompactFunction({
        summarize: async (prompt) => {
          const result = await generateText({
            model: this.resolveModel(),
            prompt
          });
          return result.text;
        }
      });

      return session
        .withContext("operating", {
          provider: { get: async () => manifest.instructions }
        })
        .withContext("soul", {
          description:
            "Your character, values, and tone. refine over time as the relationship grows.",
          provider: this.#workspaceContextProvider(SOUL_PATH),
          maxTokens: 2000
        })
        .withContext("identity", {
          description:
            "Your name and sense of self as a general purpose collaborator, update when it evolves.",
          provider: this.#workspaceContextProvider(IDENTITY_PATH),
          maxTokens: 1500
        })
        .withContext("memory", {
          description:
            "Living memory: facts, decisions, and lessons — append and prune continuously.",
          provider: this.#workspaceContextProvider(MEMORY_PATH),
          maxTokens: 4000
        })
        .withContext("user", {
          description:
            "Who you work with and how they like to collaborate, keep current as you learn.",
          provider: this.#workspaceContextProvider(USER_PATH),
          maxTokens: 2000
        })
        .onCompaction(compactFn)
        .compactAfter(150_000)
        .withCachedPrompt();
    }

    override getSkills() {
      const bundle = manifest.skills;
      const bucket = this.env.WORKSPACE_BUCKET;
      const bundled = bundle.skills.length > 0 ? fromManifest(bundle) : null;
      const remote = r2(bucket, { prefix: "skills/" });
      return bundled ? [bundled, remote] : [remote];
    }

    override getTools(): ToolSet {
      const frameworkTools = buildExecutionTools({
        executeAgent: this,
        ctx: this.ctx,
        agentName: this.name,
        env: this.env,
        getWorkspace: () => this.workspace,
        setActivePlan: (plan) => setActivePlan(this.ctx.storage, plan),
        execution: manifest.execution,
        extensions: manifest.extensions,
        extensionManager: this.extensionManager
      });
      const userTools = bindUserTools(agentUserTools, () => ({
        env: this.env,
        ctx: this.ctx,
        workspace: this.workspace,
        agentName: this.name
      }));
      const tools = mergeUserTools(frameworkTools, userTools);
      for (const [key, WorkerClass] of Object.entries(workerClasses)) {
        const subagent = manifest.subagents[key];
        if (!subagent) continue;
        tools[key] = agentTool(WorkerClass, {
          displayName: subagent.displayName,
          description: subagent.description,
          inputSchema: z.object({
            brief: z
              .string()
              .min(10)
              .describe(
                "Self contained task instructions: goal, constraints, expected output."
              )
          })
        });
      }
      return tools;
    }

    override async beforeTurn(ctx: {
      system: string;
      messages: unknown[];
      tools: ToolSet;
      continuation: boolean;
    }) {
      await this.#ensureBootstrapSeeded();
      const [bootstrap, latestPlan] = await Promise.all([
        this.workspace.readFile(BOOTSTRAP_PATH),
        this.ctx.storage.get<ActivePlan>(ACTIVE_PLAN_KEY).then((v) => v ?? null)
      ]);
      const extra = buildTurnSections({ bootstrap, latestPlan });
      return {
        system: `${ctx.system}\n\n${extra}`.trim()
      };
    }

    #bootstrapInit?: Promise<void>;

    #ensureBootstrapSeeded(): Promise<void> {
      this.#bootstrapInit ??= this.#seedBootstrapOnce();
      return this.#bootstrapInit;
    }

    async #seedBootstrapOnce(): Promise<void> {
      const seeded = await this.ctx.storage.get<boolean>(BOOTSTRAP_SEEDED_KEY);
      if (seeded === true) return;
      await this.workspace.writeFile(BOOTSTRAP_PATH, BOOTSTRAP_SEED);
      await this.ctx.storage.put(BOOTSTRAP_SEEDED_KEY, true);
    }

    #workspaceContextProvider(path: string): WritableContextProvider {
      const meta = coreFileMeta(path);
      if (!meta) {
        throw new Error(`Unknown core file path: ${path}`);
      }
      return {
        get: async () => {
          const file = await resolveCoreFile(this.workspace, meta);
          return file.content.trim();
        },
        set: async (content) => {
          await this.workspace.writeFile(path, content);
          await this.session.refreshSystemPrompt();
        }
      };
    }
  }

  Object.defineProperty(GeneratedAgent, "name", { value: className });
  return GeneratedAgent;
}

const ACTIVE_PLAN_KEY = "active_plan" as const;
async function setActivePlan(
  storage: DurableObjectStorage,
  plan: ActivePlan | null
): Promise<void> {
  if (plan == null) await storage.delete(ACTIVE_PLAN_KEY);
  else await storage.put(ACTIVE_PLAN_KEY, plan);
}
