/** 超过此长度的 data URL 不再塞进 JSON，改走 KV + GET /api/result */
export const MAX_INLINE_DATA_URL = 380 * 1024;

const RESULT_KV_PREFIX = 'result:';

/**
 * @param {string} dataUrl
 * @returns {{ mime: string, bytes: Uint8Array } | null}
 */
export function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec((dataUrl || '').trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!mime.startsWith('image/')) return null;
  const base64 = match[2].replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

/**
 * 将 OpenRouter 返回的图片引用打包为前端可消费的 JSON（避免超大 base64 内联）。
 * @param {object} env
 * @param {string} imageRef data URL 或 https 临时链
 * @param {object} meta 如 { model }
 * @param {(url: string) => Promise<string>} ensureDataUri
 * @param {URL} [requestUrl] 用于生成绝对 imageUrl，兼容未识别 imageFetchUrl 的旧前端
 */
export async function buildAnnotateSuccessBody(env, imageRef, meta, ensureDataUri, requestUrl) {
  const raw = (imageRef || '').trim();
  if (!raw) {
    const err = new Error('OpenRouter 未返回图片');
    err.httpStatus = 502;
    err.code = 'NO_IMAGE';
    throw err;
  }

  const base = { status: 'succeeded', provider: 'openrouter', ...meta };

  if (/^https?:\/\//i.test(raw)) {
    return {
      ...base,
      imageUrl: raw,
      proxyUrl: `/api/proxy-image?url=${encodeURIComponent(raw)}`,
    };
  }

  let dataUrl = raw;
  if (!raw.startsWith('data:image/')) {
    dataUrl = await ensureDataUri(raw);
  }

  if (dataUrl.length <= MAX_INLINE_DATA_URL || !env.SKETCH_JOBS) {
    return { ...base, imageDataUrl: dataUrl };
  }

  const resultId = crypto.randomUUID();
  await env.SKETCH_JOBS.put(`${RESULT_KV_PREFIX}${resultId}`, dataUrl, {
    expirationTtl: 3600,
  });
  const imageFetchUrl = `/api/result?id=${encodeURIComponent(resultId)}`;
  const body = { ...base, imageFetchUrl };
  if (requestUrl) {
    body.imageUrl = new URL(imageFetchUrl, requestUrl).href;
  }
  return body;
}

/**
 * @param {URL} url
 * @param {object} env
 * @param {Record<string, string>} cors
 */
export async function handleResultImage(url, env, cors) {
  const resultId = url.searchParams.get('id');
  if (!resultId) {
    return json({ error: 'Missing id query parameter' }, 400, cors);
  }
  if (!env.SKETCH_JOBS) {
    return json({ error: 'Result storage not configured' }, 503, cors);
  }

  const raw = await env.SKETCH_JOBS.get(`${RESULT_KV_PREFIX}${resultId}`);
  if (!raw) {
    return json({ error: 'Result not found or expired' }, 404, cors);
  }

  const parsed = parseDataUrl(raw);
  if (!parsed) {
    return json({ error: 'Invalid stored image' }, 500, cors);
  }

  return new Response(parsed.bytes, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': parsed.mime,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
