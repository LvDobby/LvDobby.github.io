import { getOpenRouterApiKey } from './openrouter.js';

const ANALYZE_PROMPT = `你是小红书生活照「手绘注释图」文案助手。仔细观察用户上传的照片，识别画面中的物体与场景，并撰写贴合情境的中文口语化短句。

必须只输出一个 JSON 对象，不要 markdown、不要解释，格式如下：
{
  "elements": ["具体物体或场景名1", "物体2", "..."],
  "labels": [
    { "text": "饮品：味道/温度/感受，8-16字", "x": 0.15, "y": 0.22, "type": "drink" },
    { "text": "食物：口感/体验，8-16字", "x": 0.62, "y": 0.40, "type": "food" },
    { "text": "环境：氛围感受，8-16字", "x": 0.12, "y": 0.65, "type": "env" },
    { "text": "收尾一句简短感悟，8-16字", "x": 0.48, "y": 0.88, "type": "summary" }
  ]
}

规则：
- elements：列出 3-6 个照片中真实可见的具体名词（如「冰美式」「可颂」「木质桌面」），不要泛泛的「饮品」「食物」
- labels：至少 3 条，最多 5 条；若某类不存在可省略，但 summary 尽量保留
- text：中文手写字风格口语碎碎念，贴合照片内容，禁止通用套话
- x、y：0~1 的小数，表示文字应放在图中对应物体附近的相对坐标（避开画面正中心主体）
- type：drink | food | env | summary | other`;

/**
 * @param {object} env
 * @param {string} dataUri
 * @returns {Promise<{ elements: string[], labels: object[] }>}
 */
export async function analyzeImageWithOpenRouter(env, dataUri) {
  const apiKey = getOpenRouterApiKey(env);
  if (!apiKey) {
    const err = new Error('Server missing OPENROUTER_API_KEY');
    err.httpStatus = 503;
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const model = env.OPENROUTER_ANALYZE_MODEL || 'google/gemini-2.5-flash';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://lvdobby.github.io',
      'X-Title': 'LvDobby Sketch Annotate',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUri } },
            { type: 'text', text: ANALYZE_PROMPT },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error('OpenRouter 响应解析失败');
    err.httpStatus = 502;
    err.code = 'UPSTREAM_ERROR';
    throw err;
  }

  if (!res.ok) {
    const message = data?.error?.message || data?.message || 'OpenRouter analyze failed';
    const err = new Error(message);
    err.httpStatus = res.status >= 400 && res.status < 500 ? res.status : 502;
    err.code = /user not found|invalid.*key|unauthorized/i.test(message) ? 'INVALID_API_KEY' : 'OPENROUTER_UPSTREAM';
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content;
  const parsed = parseAnalysisJson(text);
  if (!parsed) {
    const err = new Error('OpenRouter 未返回有效分析 JSON');
    err.httpStatus = 502;
    err.code = 'INVALID_ANALYSIS';
    throw err;
  }

  return normalizeAnalysis(parsed);
}

function parseAnalysisJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeAnalysis(raw) {
  const elements = Array.isArray(raw.elements)
    ? raw.elements.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];

  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .map((lb) => ({
          text: String(lb.text || '').trim().slice(0, 48),
          x: clampNumber(lb.x, 0.05, 0.88, 0.5),
          y: clampNumber(lb.y, 0.08, 0.92, 0.5),
          type: String(lb.type || 'other'),
        }))
        .filter((lb) => lb.text.length >= 2)
        .slice(0, 6)
    : [];

  if (labels.length < 2) {
    const err = new Error('OpenRouter 分析结果不完整');
    err.httpStatus = 502;
    err.code = 'INVALID_ANALYSIS';
    throw err;
  }

  return {
    elements: elements.length ? elements : ['生活场景'],
    labels,
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
