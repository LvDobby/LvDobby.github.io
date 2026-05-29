/**
 * 将浏览器请求转发到 Cloudflare Worker。
 * 国内网络访问 *.workers.dev 常出现 ERR_CERT_COMMON_NAME_INVALID，
 * 前端改走 *.supabase.co 本代理即可。
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WORKER_BASE =
  Deno.env.get("SKETCH_WORKER_URL") ?? "https://sketch-annotate-api.lvdobby.workers.dev";

const ALLOWED_ORIGINS = (
  Deno.env.get("SKETCH_ALLOWED_ORIGINS") ??
  "https://lvdobby.github.io,https://www.lvdobby.github.io,http://127.0.0.1:4000,http://localhost:4000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FUNCTION_PREFIX = "/functions/v1/sketch-annotate-proxy";

function corsHeaders(origin: string | null): Record<string, string> {
  let allowOrigin = ALLOWED_ORIGINS[0] ?? "*";
  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      allowOrigin = origin;
    } else if (/^https:\/\/([a-z0-9-]+\.)?lvdobby\.github\.io$/i.test(origin)) {
      allowOrigin = origin;
    }
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
  };
}

function workerPathFromRequest(url: URL): string {
  let path = url.pathname;
  if (path.startsWith(FUNCTION_PREFIX)) {
    path = path.slice(FUNCTION_PREFIX.length) || "/api/health";
  }
  if (!path.startsWith("/api/")) {
    path = "/api/health";
  }
  return path;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const incoming = new URL(req.url);
  const path = workerPathFromRequest(incoming);
  const target = `${WORKER_BASE.replace(/\/$/, "")}${path}${incoming.search}`;

  const headers = new Headers();
  const auth = req.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);
  const contentType = req.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  try {
    const upstream = await fetch(target, init);
    const respHeaders = new Headers(cors);
    const ct = upstream.headers.get("Content-Type");
    if (ct) respHeaders.set("Content-Type", ct);
    const cache = upstream.headers.get("Cache-Control");
    if (cache) respHeaders.set("Cache-Control", cache);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message, code: "PROXY_UPSTREAM" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
