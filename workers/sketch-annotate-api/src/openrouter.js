import { DOUBAO_EDIT_PROMPT, EDIT_PROMPT, RECRAFT_EDIT_PROMPT } from './prompt.js';

/** @deprecated 使用 DOUBAO_EDIT_PROMPT；保留导出供兼容 */
export const SKETCH_PROMPT = DOUBAO_EDIT_PROMPT;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * @param {object} env
 * @param {string} dataUri data:image/...;base64,...
 * @returns {Promise<string>} 生成图的 data URL
 */
export async function generateWithOpenRouter(env, dataUri, modelOverride) {
  const apiKey = getOpenRouterApiKey(env);
  if (!apiKey) {
    const err = new Error('Server missing OPENROUTER_API_KEY');
    err.httpStatus = 503;
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const models = getModelChain(env, modelOverride);
  let lastErr;
  for (const model of models) {
    try {
      return await generateWithModel(apiKey, env, dataUri, model);
    } catch (err) {
      lastErr = err;
      if (isModelFallbackError(err) && model !== models[models.length - 1]) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function getModelChain(env, modelOverride) {
  const defaultModel = env.OPENROUTER_MODEL || 'bytedance-seed/seedream-4.5';
  const envFallback = (env.OPENROUTER_FALLBACK_MODEL || '').trim();
  const primary = modelOverride || defaultModel;
  const chain = [primary];
  if (envFallback && envFallback !== primary) chain.push(envFallback);
  // 用户在前端显式选择的模型失败时，回退到站点默认模型（避免仅单模型无 fallback）
  if (defaultModel !== primary && !chain.includes(defaultModel)) {
    chain.push(defaultModel);
  }
  return chain;
}

function isGeminiImageModel(model) {
  return model.startsWith('google/gemini-') && /image/i.test(model);
}

function isDoubaoModel(model) {
  return model.startsWith('bytedance-seed/') || /seedream|doubao/i.test(model);
}

function getEditPrompt(model) {
  if (model.startsWith('recraft/')) return RECRAFT_EDIT_PROMPT;
  if (isDoubaoModel(model)) return DOUBAO_EDIT_PROMPT;
  return EDIT_PROMPT;
}

async function generateWithModel(apiKey, env, dataUri, model) {
  const payload = JSON.stringify(buildRequestBody(env, dataUri, model));
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

function buildRequestBody(env, dataUri, model) {
  const isRecraft = model.startsWith('recraft/');
  const isDoubao = isDoubaoModel(model);
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: getEditPrompt(model) },
        ],
      },
    ],
    modalities: getOutputModalities(model),
  };

  if (isRecraft) {
    const strength = parseFloat(env.OPENROUTER_IMAGE_STRENGTH || '0.12', 10);
    body.image_config = {
      strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.12,
    };
  } else if (isDoubao) {
    body.image_config = {
      image_size: '2K',
    };
  } else if (isGeminiImageModel(model)) {
    body.image_config = {
      image_size: '2K',
    };
  } else {
    body.image_config = {
      image_size: '1K',
    };
  }

  return body;
}

/** Gemini 等支持 image+text；Recraft/豆包/Flux 等仅 image 输出 */
function getOutputModalities(model) {
  if (
    model.startsWith('recraft/') ||
    model.startsWith('bytedance-seed/') ||
    /seedream|doubao/i.test(model) ||
    model.startsWith('black-forest-labs/') ||
    model.startsWith('sourceful/')
  ) {
    return ['image'];
  }
  return ['image', 'text'];
}

function isModelFallbackError(err) {
  return /not available in your region|model not found|does not support|unsupported model|no endpoints found|output modalities|provider returned error/i.test(
    err.message || '',
  );
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
  return /network connection lost|provider_unavailable|provider returned error|timeout|timed out|overloaded|temporarily unavailable/i.test(
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
      if (part.type === 'image_url' && part.imageUrl?.url) {
        return part.imageUrl.url;
      }
      const inline = part.inline_data || part.inlineData;
      if (inline?.data) {
        const mime = inline.mime_type || inline.mimeType || 'image/png';
        return `data:${mime};base64,${inline.data}`;
      }
    }
  }

  return null;
}

function extractOpenRouterError(data) {
  if (typeof data?.error?.message === 'string' && data.error.message !== 'Provider returned error') {
    return data.error.message;
  }
  const raw = data?.error?.metadata?.raw;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.message === 'string') return raw.message;
    if (typeof raw.error === 'string') return raw.error;
    if (typeof raw.detail === 'string') return raw.detail;
  }
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
  let m = message || '';
  try {
    if (m.trim().startsWith('{')) {
      const obj = JSON.parse(m);
      m = obj.message || obj.code || m;
    }
  } catch {
    /* keep original */
  }
  if (/credit|balance|billing|insufficient/i.test(m)) {
    return 'OpenRouter 余额不足，请前往 https://openrouter.ai/credits 充值后再试';
  }
  if (/user not found|invalid.*key|unauthorized/i.test(m)) {
    return 'OpenRouter API Key 无效或已过期，请在 workers/sketch-annotate-api 目录执行：npx wrangler secret put OPENROUTER_API_KEY';
  }
  if (/network connection lost|provider_unavailable|timeout|timed out|overloaded/i.test(m)) {
    return 'OpenRouter 上游暂时不可用（网络中断或生成超时），请稍后重试';
  }
  if (/not available in your region|region/i.test(m)) {
    return 'Gemini 图像模型在当前区域不可用，系统将自动尝试 Recraft 备用模型；若仍失败请在 wrangler.toml 设置 OPENROUTER_MODEL';
  }
  if (/provider returned error/i.test(m)) {
    return 'Recraft 图像生成失败，请换一张较小的 JPG/PNG 图片重试，或稍后再试';
  }
  if (/invalid_image_format|unknown format|仅支持 JPG/i.test(m)) {
    return '图片格式不支持，请使用 JPG 或 PNG（iPhone 可在「设置→相机→格式」选「最兼容」）';
  }
  return m;
}
