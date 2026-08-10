import { json } from "../http";
import type { CrazpRouteConfig } from "../../types";

async function parseWriteBody(
  request: Request
): Promise<{ ok: true; content: string } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400) };
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { content?: unknown }).content !== "string"
  ) {
    return {
      ok: false,
      response: json({ error: "Missing `content` string" }, 400)
    };
  }
  return { ok: true, content: (raw as { content: string }).content };
}

export async function handleFilesRequest<Env>(
  request: Request,
  env: Env,
  config: CrazpRouteConfig<Env>
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  const path = parts.slice(3).map(decodeURIComponent).join("/");

  if (parts[2] !== "core") {
    return json({ error: "Not found" }, 404);
  }

  const stub = await config.getAgentStub(env, config.defaultInstanceName);

  if (path === "") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }
    const files = await stub.listCoreFiles();
    return json({ files });
  }

  if (request.method === "GET") {
    const file = await stub.readCoreFile(path);
    if (!file) return json({ error: "Unknown core file path" }, 400);
    return json({ file });
  }

  if (request.method === "PUT") {
    const parsed = await parseWriteBody(request);
    if (!parsed.ok) return parsed.response;
    await stub.writeCoreFile(path, parsed.content);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
