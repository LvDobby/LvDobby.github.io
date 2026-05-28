import { SKETCH_PROMPT } from './prompt.js';

const MAX_BYTES = 10 * 1024 * 1024;
const REPLICATE_HOST_SUFFIX = 'replicate.delivery';

export default {
  async fetch(request, env) {
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
        return json({ ok: true, model: env.REPLICATE_MODEL }, 200, cors);
      }

      if (path === '/api/annotate' && request.method === 'POST') {
        return await handleAnnotate(request, env, cors);
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

async function handleAnnotate(request, env, cors) {
  const denied = requireAuth(request, env, cors);
  if (denied) return denied;

  if (!env.REPLICATE_API_TOKEN) {
    return json({ error: 'Server missing REPLICATE_API_TOKEN' }, 503, cors);
  }

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
  const prediction = await createReplicatePrediction(env, dataUri);

  return json(
    {
      jobId: prediction.id,
      status: prediction.status,
      message: 'Job created. Poll GET /api/status?id=' + prediction.id,
    },
    200,
    cors,
  );
}

async function handleStatus(url, env, cors) {
  const jobId = url.searchParams.get('id');
  if (!jobId) {
    return json({ error: 'Missing id query parameter' }, 400, cors);
  }
  if (!env.REPLICATE_API_TOKEN) {
    return json({ error: 'Server missing REPLICATE_API_TOKEN' }, 503, cors);
  }

  const prediction = await getReplicatePrediction(env, jobId);
  const body = { jobId: prediction.id, status: prediction.status };

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
  const headers = {
    ...cors,
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  };
  return new Response(upstream.body, { status: 200, headers });
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

async function createReplicatePrediction(env, dataUri) {
  const modelPath = env.REPLICATE_MODEL || 'black-forest-labs/flux-kontext-dev';
  const parts = modelPath.split('/');
  if (parts.length !== 2) {
    throw new Error('REPLICATE_MODEL must be owner/name');
  }
  const [owner, name] = parts;
  const endpoint = `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt: SKETCH_PROMPT,
        input_image: dataUri,
        aspect_ratio: 'match_input_image',
        output_format: 'png',
        safety_tolerance: 2,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.error || `Replicate error ${res.status}`);
  }
  return data;
}

async function getReplicatePrediction(env, id) {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.error || `Replicate error ${res.status}`);
  }
  return data;
}

function extractOutputUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length) return output[0];
  return null;
}
