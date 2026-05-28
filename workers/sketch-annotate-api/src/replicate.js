import { SKETCH_PROMPT } from './prompt.js';

export function humanizeReplicateError(message) {
  const m = message || '';
  if (/insufficient credit/i.test(m)) {
    return 'Replicate 账户余额不足，请前往 https://replicate.com/account/billing 充值后再试';
  }
  return m;
}

function extractReplicateMessage(data) {
  if (typeof data.detail === 'string') return data.detail;
  if (typeof data.error === 'string') return data.error;
  if (Array.isArray(data.detail)) {
    return data.detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('; ');
  }
  return 'Replicate request failed';
}

function httpStatusForReplicate(message, upstreamStatus) {
  if (/insufficient credit|billing/i.test(message)) return 402;
  if (upstreamStatus === 401) return 401;
  if (upstreamStatus === 422) return 422;
  if (upstreamStatus >= 400 && upstreamStatus < 500) return upstreamStatus;
  return 502;
}

export async function createReplicatePrediction(env, dataUri) {
  if (!env.REPLICATE_API_TOKEN) {
    const err = new Error('Server missing REPLICATE_API_TOKEN');
    err.httpStatus = 503;
    throw err;
  }

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
    const message = extractReplicateMessage(data);
    const err = new Error(message);
    err.httpStatus = httpStatusForReplicate(message, res.status);
    err.code = /insufficient credit/i.test(message) ? 'INSUFFICIENT_CREDIT' : 'REPLICATE_UPSTREAM';
    throw err;
  }
  return data;
}

export async function getReplicatePrediction(env, id) {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractReplicateMessage(data));
  }
  return data;
}

export function extractOutputUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length) return output[0];
  return null;
}
