import { SKETCH_PROMPT } from './prompt.js';

/** 强调在原图基础上为每个元素叠加手绘注释 */
export const EDIT_PROMPT =
  '【任务】图像编辑：在原图基础上叠加手绘注释，输出编辑后的完整图片。\n' +
  '【硬性要求】\n' +
  '1. 必须基于我上传的原图修改，保留原图主体、构图、光线与色彩\n' +
  '2. 为画面中每个主要元素分别添加有意义的手绘注释（轮廓线 + 短文案 + 少量装饰）\n' +
  '3. 不要整图重绘、不要换场景、不要改变原图内容\n\n' +
  SKETCH_PROMPT;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * @param {object} env
 * @param {string} dataUri data:image/...;base64,...
 * @returns {Promise<string>} 生成图的 data URL
 */
export async function generateWithOpenRouter(env, dataUri) {
  const apiKey = getOpenRouterApiKey(env);
  if (!apiKey) {
    const err = new Error('Server missing OPENROUTER_API_KEY');
    err.httpStatus = 503;
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const model = env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-image';
  const isRecraft = model.startsWith('recraft/');

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: EDIT_PROMPT },
        ],
      },
    ],
    modalities: ['image', 'text'],
  };

  if (isRecraft) {
    const strength = parseFloat(env.OPENROUTER_IMAGE_STRENGTH || '0.18', 10);
    body.image_config = {
      strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.18,
    };
  } else {
    body.image_config = {
      image_size: '1K',
    };
  }

  const payload = JSON.stringify(body);
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await callOpenRouter(apiKey, payload);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function getOpenRouterApiKey(env) {
  return (env.OPENROUTER_API_KEY || '').trim();
}

export { getOpenRouterApiKey };

/** @returns {Promise<{ ok: boolean, reason?: string, label?: string }>} */
export async function verifyOpenRouterKey(env) {
  const apiKey = getOpenRouterApiKey(env);
  if (!apiKey) return { ok: false, reason: 'missing' };
  if (!/^sk-or-v1-/.test(apiKey)) {
    return {
      ok: false,
      reason: 'invalid_format',
      hint: `Key must start with sk-or-v1- (OpenRouter). Stored length=${apiKey.length}, prefix=${apiKey.slice(0, 4) || '(empty)'}`,
    };
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return { ok: true, label: data?.data?.label || 'valid' };
    }
    const reason = data?.error?.message || data?.message || `HTTP ${res.status}`;
    return { ok: false, reason };
  } catch (e) {
    return { ok: false, reason: e.message || 'network_error' };
  }
}

async function callOpenRouter(apiKey, payload) {
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lvdobby.github.io',
        'X-Title': 'LvDobby Sketch Annotate',
      },
      body: payload,
    });
  } catch (e) {
    const err = new Error(e.message || 'Network error');
    err.httpStatus = 502;
    err.code = 'UPSTREAM_ERROR';
    err.retryable = true;
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error('OpenRouter 响应解析失败');
    err.httpStatus = 502;
    err.code = 'UPSTREAM_ERROR';
    err.retryable = true;
    throw err;
  }

  if (!res.ok) {
    const message = extractOpenRouterError(data);
    const err = new Error(message);
    err.httpStatus = httpStatusForOpenRouter(message, res.status);
    if (/credit|balance|billing|402/i.test(message)) {
      err.code = 'INSUFFICIENT_CREDIT';
    } else if (/user not found|invalid.*key|unauthorized|401/i.test(message)) {
      err.code = 'INVALID_API_KEY';
    } else {
      err.code = 'OPENROUTER_UPSTREAM';
    }
    err.retryable = isRetryableMessage(message, res.status);
    throw err;
  }

  const imageUrl = extractImageDataUrl(data);
  if (!imageUrl) {
    const err = new Error('OpenRouter 未返回图片，请稍后重试或更换模型');
    err.httpStatus = 502;
    err.code = 'NO_IMAGE';
    throw err;
  }
  return imageUrl;
}

function isRetryable(err) {
  if (err.retryable) return true;
  return isRetryableMessage(err.message, err.httpStatus);
}

function isRetryableMessage(message, status) {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return /network connection lost|provider_unavailable|timeout|timed out|overloaded|temporarily unavailable/i.test(
    message || '',
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractImageDataUrl(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return null;

  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      const url = img?.image_url?.url || img?.imageUrl?.url;
      if (url) return url;
    }
  }

  if (typeof message.content === 'string' && message.content.startsWith('data:image')) {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        return part.image_url.url;
      }
    }
  }

  return null;
}

function extractOpenRouterError(data) {
  if (typeof data?.error?.message === 'string') return data.error.message;
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.message === 'string') return data.message;
  return 'OpenRouter request failed';
}

function httpStatusForOpenRouter(message, upstreamStatus) {
  const m = (message || '').toLowerCase();
  if (/credit|balance|billing|insufficient|402/.test(m)) return 402;
  if (upstreamStatus === 401) return 401;
  if (upstreamStatus === 429) return 429;
  if (upstreamStatus >= 400 && upstreamStatus < 500) return upstreamStatus;
  return 502;
}

export function humanizeOpenRouterError(message) {
  const m = message || '';
  if (/credit|balance|billing|insufficient/i.test(m)) {
    return 'OpenRouter 余额不足，请前往 https://openrouter.ai/credits 充值后再试';
  }
  if (/user not found|invalid.*key|unauthorized/i.test(m)) {
    return 'OpenRouter API Key 无效或已过期，请在 workers/sketch-annotate-api 目录执行：npx wrangler secret put OPENROUTER_API_KEY';
  }
  if (/network connection lost|provider_unavailable|timeout|timed out|overloaded/i.test(m)) {
    return 'OpenRouter 上游暂时不可用（网络中断或生成超时），请稍后重试';
  }
  return m;
}
