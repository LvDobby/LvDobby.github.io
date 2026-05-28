import { generateWithOpenRouter, humanizeOpenRouterError, verifyOpenRouterKey, getOpenRouterApiKey } from './openrouter.js';
import { analyzeImageWithOpenRouter } from './analyze.js';
import { fileToDataUri, ensureDataUri } from './image.js';
import { buildAnnotateSuccessBody, handleResultImage } from './result.js';
import {
  createReplicatePrediction,
  extractOutputUrl,
  getReplicatePrediction,
  humanizeReplicateError,
} from './replicate.js';

const MAX_BYTES = 10 * 1024 * 1024;
const REPLICATE_HOST_SUFFIX = 'replicate.delivery';
const JOB_TTL = 3600;

/** 允许 Worker 代理拉取的外链图床（OpenRouter / Gemini / Replicate 等） */
const PROXY_IMAGE_HOST_SUFFIXES = [
  REPLICATE_HOST_SUFFIX,
  'replicate.delivery',
  'openrouter.ai',
  'googleusercontent.com',
  'googleapis.com',
  'blob.core.windows.net',
  'oaiusercontent.com',
  'cloudfront.net',
];

/** 前端可选模型（与 sketch-annotate.html 单选值一致） */
const ALLOWED_IMAGE_MODELS = new Set([
  'bytedance-seed/seedream-4.5',
  'google/gemini-3-pro-image-preview',
]);

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!isOriginAllowed(request, env)) {
      return json({ error: 'Origin not allowed' }, 403, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/health' && request.method === 'GET') {
        const body = {
          ok: true,
          provider: getProvider(env),
          model: getModelLabel(env),
          fallbackModel: env.OPENROUTER_FALLBACK_MODEL || null,
          analyzeModel: getAnalyzeModelLabel(env),
          mode: getProvider(env) === 'openrouter' ? 'image-gen' : getProvider(env),
          async: getProvider(env) === 'replicate',
        };
        if (url.searchParams.get('verify') === '1' && getProvider(env) === 'openrouter') {
          body.openrouterKey = await verifyOpenRouterKey(env);
        }
        return json(body, 200, cors);
      }

      if (path === '/api/analyze' && request.method === 'POST') {
        return await handleAnalyze(request, env, cors);
      }

      if (path === '/api/annotate' && request.method === 'POST') {
        return await handleAnnotate(request, env, ctx, cors);
      }

      if (path === '/api/status' && request.method === 'GET') {
        return await handleStatus(url, env, cors);
      }

      if (path === '/api/proxy-image' && request.method === 'GET') {
        return await handleProxyImage(url, env, cors);
      }

      if (path === '/api/result' && request.method === 'GET') {
        return await handleResultImage(url, env, cors);
      }

      return json({ error: 'Not Found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || 'Internal error' }, 500, cors);
    }
  },
};

function getProvider(env) {
  return (env.IMAGE_PROVIDER || 'openrouter').toLowerCase();
}

function getAnalyzeModelLabel(env) {
  return env.OPENROUTER_ANALYZE_MODEL || 'google/gemini-2.5-flash';
}

function getModelLabel(env) {
  if (getProvider(env) === 'replicate') {
    return env.REPLICATE_MODEL || 'black-forest-labs/flux-kontext-dev';
  }
  return env.OPENROUTER_MODEL || 'bytedance-seed/seedream-4.5';
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const allowed = parseOrigins(env.ALLOWED_ORIGINS);
  return allowed.includes(origin);
}

function parseOrigins(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = parseOrigins(env.ALLOWED_ORIGINS);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function requireAuth(request, env, cors) {
  if (!env.ANNOTATE_TOKEN) return null;
  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ANNOTATE_TOKEN}`;
  if (auth !== expected) {
    return json({ error: 'Unauthorized' }, 401, cors);
  }
  return null;
}

async function handleAnalyze(request, env, cors) {
  const denied = requireAuth(request, env, cors);
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') {
    return json({ error: 'Missing image field' }, 400, cors);
  }
  if (!file.type.startsWith('image/')) {
    return json({ error: 'File must be an image' }, 400, cors);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: 'Image exceeds 10MB limit' }, 400, cors);
  }

  if (getProvider(env) !== 'openrouter') {
    return json({ error: 'Analyze endpoint requires IMAGE_PROVIDER=openrouter' }, 400, cors);
  }
  if (!getOpenRouterApiKey(env)) {
    return json({ error: 'Server missing OPENROUTER_API_KEY', code: 'MISSING_API_KEY' }, 503, cors);
  }

  try {
    const dataUri = await fileToDataUri(file);
    const analysis = await analyzeImageWithOpenRouter(env, dataUri);
    return json({ status: 'succeeded', provider: 'openrouter', mode: 'hybrid', analysis }, 200, cors);
  } catch (err) {
    return providerErrorResponse(err, 'openrouter', cors);
  }
}

async function handleAnnotate(request, env, ctx, cors) {
  const denied = requireAuth(request, env, cors);
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') {
    return json({ error: 'Missing image field' }, 400, cors);
  }
  if (!file.type.startsWith('image/')) {
    return json({ error: 'File must be an image' }, 400, cors);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: 'Image exceeds 10MB limit' }, 400, cors);
  }

  const dataUri = await fileToDataUri(file);
  const provider = getProvider(env);
  const model = resolveAnnotateModel(form.get('model'), env);

  if (provider === 'replicate') {
    return handleAnnotateReplicate(env, dataUri, cors);
  }

  return handleAnnotateOpenRouter(env, ctx, dataUri, cors, model);
}

function resolveAnnotateModel(raw, env) {
  const requested = typeof raw === 'string' ? raw.trim() : '';
  if (requested && ALLOWED_IMAGE_MODELS.has(requested)) return requested;
  return getModelLabel(env);
}

/**
 * OpenRouter 改图：在 POST 请求内同步等待完成。
 * 不可使用 ctx.waitUntil + KV 异步：客户端收到 jobId 后会断开连接，
 * waitUntil 仅延长约 30s，长时生成会被中断并一直停在 processing。
 */
async function handleAnnotateOpenRouter(env, _ctx, dataUri, cors, model) {
  try {
    const imageRef = await generateWithOpenRouter(env, dataUri, model);
    const body = await buildAnnotateSuccessBody(env, imageRef, { model }, ensureDataUri);
    return json(body, 200, cors);
  } catch (err) {
    return providerErrorResponse(err, 'openrouter', cors);
  }
}

async function handleAnnotateReplicate(env, dataUri, cors) {
  try {
    const prediction = await createReplicatePrediction(env, dataUri);
    return json(
      {
        jobId: prediction.id,
        status: prediction.status,
        provider: 'replicate',
        message: 'Poll GET /api/status?id=' + prediction.id,
      },
      200,
      cors,
    );
  } catch (err) {
    return providerErrorResponse(err, 'replicate', cors);
  }
}

function providerErrorResponse(err, provider, cors) {
  const status = err.httpStatus || 502;
  const humanize = provider === 'openrouter' ? humanizeOpenRouterError : humanizeReplicateError;
  return json(
    {
      error: humanize(err.message),
      code: err.code || 'UPSTREAM_ERROR',
      provider,
    },
    status,
    cors,
  );
}

async function handleStatus(url, env, cors) {
  const jobId = url.searchParams.get('id');
  if (!jobId) {
    return json({ error: 'Missing id query parameter' }, 400, cors);
  }

  if (env.SKETCH_JOBS) {
    const raw = await env.SKETCH_JOBS.get(jobId);
    if (raw) {
      const job = JSON.parse(raw);
      const body = { jobId, status: job.status, provider: job.provider || 'openrouter' };
      if (job.status === 'succeeded') {
        if (job.imageFetchUrl) body.imageFetchUrl = job.imageFetchUrl;
        else if (job.imageDataUrl) body.imageDataUrl = job.imageDataUrl;
        else if (job.imageUrl) {
          body.imageUrl = job.imageUrl;
          if (job.proxyUrl) body.proxyUrl = job.proxyUrl;
        }
      }
      if (job.status === 'failed') {
        body.error = job.error || 'Generation failed';
        if (job.code) body.code = job.code;
      }
      if (job.status === 'processing') {
        body.message = 'Still processing';
      }
      return json(body, 200, cors);
    }
  }

  if (!env.REPLICATE_API_TOKEN) {
    return json({ error: 'Job not found' }, 404, cors);
  }

  const prediction = await getReplicatePrediction(env, jobId);
  const body = { jobId: prediction.id, status: prediction.status, provider: 'replicate' };

  if (prediction.status === 'succeeded') {
    const imageUrl = extractOutputUrl(prediction.output);
    body.imageUrl = imageUrl;
    if (imageUrl) {
      body.proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    }
  } else if (prediction.status === 'failed') {
    body.error = prediction.error || 'Generation failed';
  } else {
    body.message = 'Still processing';
  }

  return json(body, 200, cors);
}

async function handleProxyImage(url, env, cors) {
  const target = url.searchParams.get('url');
  if (!target) {
    return json({ error: 'Missing url parameter' }, 400, cors);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: 'Invalid url' }, 400, cors);
  }

  if (!isProxyImageUrlAllowed(parsed)) {
    return json({ error: 'URL not allowed' }, 403, cors);
  }

  const upstream = await fetch(target);
  if (!upstream.ok) {
    return json({ error: 'Failed to fetch image' }, 502, cors);
  }

  const contentType = upstream.headers.get('Content-Type') || 'image/png';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function isProxyImageUrlAllowed(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (host.includes('replicate')) return true;
  if (host.includes('openrouter')) return true;
  if (/byteimg|bytecdn|volces|bytedance|seedream/i.test(host)) return true;
  return PROXY_IMAGE_HOST_SUFFIXES.some(function (suffix) {
    return host === suffix || host.endsWith('.' + suffix);
  });
}

