import { generateWithOpenRouter, humanizeOpenRouterError } from './openrouter.js';
import {
  createReplicatePrediction,
  extractOutputUrl,
  getReplicatePrediction,
  humanizeReplicateError,
} from './replicate.js';

const MAX_BYTES = 10 * 1024 * 1024;
const REPLICATE_HOST_SUFFIX = 'replicate.delivery';
const JOB_TTL = 3600;

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
        return json(
          {
            ok: true,
            provider: getProvider(env),
            model: getModelLabel(env),
            async: !!env.SKETCH_JOBS,
          },
          200,
          cors,
        );
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

function getModelLabel(env) {
  if (getProvider(env) === 'replicate') {
    return env.REPLICATE_MODEL || 'black-forest-labs/flux-kontext-dev';
  }
  return env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-image';
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

  if (provider === 'replicate') {
    return handleAnnotateReplicate(env, dataUri, cors);
  }

  return handleAnnotateOpenRouter(env, ctx, dataUri, cors);
}

async function handleAnnotateOpenRouter(env, ctx, dataUri, cors) {
  if (env.SKETCH_JOBS) {
    const jobId = crypto.randomUUID();
    await env.SKETCH_JOBS.put(
      jobId,
      JSON.stringify({ status: 'processing', provider: 'openrouter' }),
      { expirationTtl: JOB_TTL },
    );
    ctx.waitUntil(runOpenRouterJob(jobId, dataUri, env));
    return json(
      {
        jobId,
        status: 'processing',
        provider: 'openrouter',
        message: 'Poll GET /api/status?id=' + jobId,
      },
      200,
      cors,
    );
  }

  try {
    const imageDataUrl = await generateWithOpenRouter(env, dataUri);
    return json(
      {
        status: 'succeeded',
        provider: 'openrouter',
        imageDataUrl,
      },
      200,
      cors,
    );
  } catch (err) {
    return providerErrorResponse(err, 'openrouter', cors);
  }
}

async function runOpenRouterJob(jobId, dataUri, env) {
  try {
    const imageDataUrl = await generateWithOpenRouter(env, dataUri);
    await env.SKETCH_JOBS.put(
      jobId,
      JSON.stringify({
        status: 'succeeded',
        provider: 'openrouter',
        imageDataUrl,
      }),
      { expirationTtl: JOB_TTL },
    );
  } catch (err) {
    await env.SKETCH_JOBS.put(
      jobId,
      JSON.stringify({
        status: 'failed',
        provider: 'openrouter',
        error: humanizeOpenRouterError(err.message),
        code: err.code || 'UPSTREAM_ERROR',
      }),
      { expirationTtl: JOB_TTL },
    );
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
      if (job.status === 'succeeded' && job.imageDataUrl) {
        body.imageDataUrl = job.imageDataUrl;
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

  if (!parsed.hostname.endsWith(REPLICATE_HOST_SUFFIX) && !parsed.hostname.includes('replicate')) {
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

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return btoa(binary);
}

async function fileToDataUri(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const b64 = bytesToBase64(bytes);
  const mime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}
