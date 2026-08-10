/**
 * TODO:
 * Framework-owned REST API surface. Users do not define these routes.
 * More routes will be added here over time.
 */
export async function handleFrameworkRequest(
  request: Request
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/health" && request.method === "GET") {
    return new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  return null;
}
