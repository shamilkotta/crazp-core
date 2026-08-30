import {
  type DurableObjectStorageLike,
  type ThinkWorkspaceCompatibility,
  Workspace,
  WorkspaceProxy,
  WorkspaceServiceProxy,
  type WorkspaceRegisteredBackend
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer
} from "@cloudflare/computer/backends/container";
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell";
import curlShell from "@cloudflare/computer/shell/curl";
import fileShell from "@cloudflare/computer/shell/file";
import jqShell from "@cloudflare/computer/shell/jq";
import sqliteShell from "@cloudflare/computer/shell/sqlite";
import yqShell from "@cloudflare/computer/shell/yq";
import { Think } from "@cloudflare/think";

export { WorkspaceProxy, WorkspaceServiceProxy };

export type CrazpComputerWorkspace = Workspace & ThinkWorkspaceCompatibility;

export type CrazpComputerThinkEnv = {
  LOADER: WorkerLoader;
  [key: string]: unknown;
};

function workspaceRef(className: string, ctx: DurableObjectState) {
  return { binding: className, id: ctx.id.toString() };
}

export const SHELL_BACKEND_DESCRIPTION =
  "just-bash in a Dynamic Worker. Cold-starts quickly with no container. " +
  "Use for cat, grep, sed, awk, jq, yq, sqlite, curl, find, head, tail, " +
  "sort, and quick file inspection. Built-in git forwards to the host workspace (https:// only). " +
  "Cannot run npm, node, python, or native binaries outside just-bash.";

export const CONTAINER_BACKEND_DESCRIPTION =
  "Full Linux userland via computerd in a Cloudflare Container: npm, node, " +
  "python, package managers, test runners, and real binaries on PATH with " +
  "network access. Cold-starts slower — use when the shell backend cannot " +
  "run the command.";

export function createContainerBackend(args: {
  className: string;
  ctx: DurableObjectState;
  container: () => {
    getWorkspaceContainer(): unknown;
  };
}): CloudflareContainerBackend {
  return new CloudflareContainerBackend({
    id: "container",
    container: args.container as never,
    workspace: workspaceRef(args.className, args.ctx),
    egress: { mode: "direct" }
  });
}

export function createComputerWorkspace(args: {
  ctx: DurableObjectState;
  env: CrazpComputerThinkEnv;
  className: string;
  containerBackend: CloudflareContainerBackend;
  enableContainer: boolean;
}): CrazpComputerWorkspace {
  const ref = workspaceRef(args.className, args.ctx);
  const backends: WorkspaceRegisteredBackend[] = [
    new WorkerShellBackend({
      id: "shell",
      loader: args.env.LOADER,
      workspace: ref,
      ctx: args.ctx,
      commands: [curlShell, fileShell, jqShell, sqliteShell, yqShell]
    })
  ];
  if (args.enableContainer) {
    backends.push(args.containerBackend);
  }
  return new Workspace({
    storage: args.ctx.storage as unknown as DurableObjectStorageLike,
    backends,
    useThink: true
  }) as CrazpComputerWorkspace;
}

type ThinkSubclass = new (
  ctx: DurableObjectState,
  env: CrazpComputerThinkEnv
) => Think<CrazpComputerThinkEnv>;

export function createComputerThinkClass(
  ThinkBase: ThinkSubclass,
  className: string,
  enableContainer: boolean
): ThinkSubclass {
  class ComputerThinkBase extends withWorkspaceContainer(ThinkBase) {
    override workspaceBash = false;

    readonly #containerBackend = createContainerBackend({
      className,
      ctx: this.ctx,
      container: () => this as { getWorkspaceContainer(): unknown }
    });

    override workspace = createComputerWorkspace({
      ctx: this.ctx,
      env: this.env as CrazpComputerThinkEnv,
      className,
      containerBackend: this.#containerBackend,
      enableContainer
    });

    override async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname === "/api") {
        return this.#containerBackend.handleFetch(request);
      }
      return super.fetch(request);
    }

    async __getWorkspaceStub(): Promise<
      ReturnType<CrazpComputerWorkspace["stub"]>
    > {
      await this.workspace.ready();
      return this.workspace.stub();
    }
  }

  Object.defineProperty(ComputerThinkBase, "name", { value: className });
  return ComputerThinkBase as ThinkSubclass;
}
