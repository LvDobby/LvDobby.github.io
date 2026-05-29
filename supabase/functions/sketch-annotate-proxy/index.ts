/**
 * 将浏览器请求转发到 Cloudflare Worker，或转发 Supabase REST/Auth（国内直连 REST 易失败）。
 * 国内网络访问 *.workers.dev 常出现 ERR_CERT_COMMON_NAME_INVALID，
 * 前端改走 *.supabase.co/functions/v1/sketch-annotate-proxy 即可。
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WORKER_BASE =
  Deno.env.get("SKETCH_WORKER_URL") ?? "https://sketch-annotate-api.lvdobby.workers.dev";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "https://ejgemmhyeeuiudhqlioc.supabase.co";

const ALLOWED_ORIGINS = (
  Deno.env.get("SKETCH_ALLOWED_ORIGINS") ??
  "https://lvdobby.github.io,https://www.lvdobby.github.io,https://qiubaiying.top,https://www.qiubaiying.top,http://127.0.0.1:4000,http://localhost:4000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FORWARD_HEADERS = [
  "Authorization",
  "apikey",
  "Content-Type",
  "Prefer",
  "Accept",
  "x-client-info",
  "content-profile",
  "Range",
  "Accept-Profile",
  "Content-Profile",
];

function corsHeaders(origin: string | null): Record<string, string> {
  let allowOrigin = ALLOWED_ORIGINS[0] ?? "*";
  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      allowOrigin = origin;
    } else if (/^https:\/\/([a-z0-9-]+\.)?lvdobby\.github\.io$/i.test(origin)) {
      allowOrigin = origin;
    } else if (/^https:\/\/(www\.)?qiubaiying\.top$/i.test(origin)) {
      allowOrigin = origin;
    }
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": FORWARD_HEADERS.join(", "),
    "Access-Control-Max-Age": "86400",
  };
}

function parseProxyPath(raw: string): { pathname: string; search: string } {
  let path = raw.trim();
  if (!path.startsWith("/")) path = `/${path}`;
  const qIdx = path.indexOf("?");
  if (qIdx === -1) return { pathname: path, search: "" };
  return { pathname: path.slice(0, qIdx), search: path.slice(qIdx) };
}

function workerPathFromRequest(url: URL): string {
  const fromQuery = url.searchParams.get("path");
  if (fromQuery) {
    const { pathname } = parseProxyPath(fromQuery);
    if (pathname.startsWith("/supabase/")) return fromQuery.trim();
    if (pathname.startsWith("/api/")) return pathname;
  }

  const route = "/functions/v1/sketch-annotate-proxy";
  let suffix = "";

  if (url.pathname.startsWith(route)) {
    suffix = url.pathname.slice(route.length);
  }

  if (!suffix) {
    const pathOnly = url.href.split("?")[0];
    const idx = pathOnly.indexOf(route);
    if (idx !== -1) {
      suffix = pathOnly.slice(idx + route.length);
    }
  }

  let path = (suffix || "/api/health").trim();
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.startsWith("/api/")) path = "/api/health";
  return path;
}

function workerSearchFromRequest(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("path");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function forwardRequestHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function proxyResponse(upstream: Response, cors: Record<string, string>): Response {
  const respHeaders = new Headers(cors);
  const passThrough = [
    "Content-Type",
    "Cache-Control",
    "Content-Range",
    "Location",
    "Set-Cookie",
  ];
  for (const name of passThrough) {
    const value = upstream.headers.get(name);
    if (value) respHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const incoming = new URL(req.url);
  const rawPath = workerPathFromRequest(incoming);
  const { pathname, search } = parseProxyPath(rawPath);
  const headers = forwardRequestHeaders(req);

  const init: RequestInit = { method: req.method, headers };
  if (pathname.startsWith("/supabase/auth/")) {
    init.redirect = "manual";
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  let target: string;
  if (pathname.startsWith("/supabase/")) {
    const supabasePath = pathname.slice("/supabase".length) + search;
    target = `${SUPABASE_URL.replace(/\/$/, "")}${supabasePath}`;
  } else {
    const workerPath = pathname.startsWith("/api/") ? pathname : "/api/health";
    target = `${WORKER_BASE.replace(/\/$/, "")}${workerPath}${workerSearchFromRequest(incoming)}`;
  }

  try {
    const upstream = await fetch(target, init);
    return proxyResponse(upstream, cors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message, code: "PROXY_UPSTREAM" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
