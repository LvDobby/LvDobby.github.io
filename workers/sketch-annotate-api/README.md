# sketch-annotate-api（Cloudflare Workers）

为 [生活手绘注释图](/sketch-annotate.html) 提供云端识图代理。**默认混合模式**：OpenRouter 视觉模型识图并生成情境文案，浏览器端 Canvas 沿物体边缘精绘白色描线（保真原图）。

## 1. 前置条件

1. 注册 [OpenRouter](https://openrouter.ai/) 并充值：[Credits](https://openrouter.ai/credits)
2. 创建 API Key：[Keys](https://openrouter.ai/keys)
3. 注册 [Cloudflare](https://dash.cloudflare.com/)（免费即可）
4. Node.js 18+

## 2. 安装

```bash
cd workers
npm install
npx wrangler login
```

## 3. 配置密钥

```bash
cd sketch-annotate-api
npx wrangler secret put OPENROUTER_API_KEY
# 粘贴 sk-or-v1-...

# 可选：防止他人刷额度
npx wrangler secret put ANNOTATE_TOKEN
```

## 4. 配置 KV（推荐，避免生成超时）

OpenRouter 图像生成可能超过 30 秒，建议启用异步任务：

```bash
npx wrangler kv namespace create SKETCH_JOBS
```

将返回的 `id` 写入 `wrangler.toml`，取消注释：

```toml
[[kv_namespaces]]
binding = "SKETCH_JOBS"
id = "上一步返回的 id"
```

本地开发可在 `.dev.vars` 中配置 `OPENROUTER_API_KEY`，并添加 `preview_id`。

## 5. 部署

```bash
npm run deploy
# 或从 workers 目录：npm run deploy -w sketch-annotate-api
```

记下 `https://sketch-annotate-api.<子域>.workers.dev`，填入博客 `_config.yml` 的 `sketch_api_url`。

## 6. 模型说明

| 变量 | 默认 | 说明 |
|------|------|------|
| `IMAGE_PROVIDER` | `openrouter` | `openrouter` 或 `replicate` |
| `OPENROUTER_ANALYZE_MODEL` | `google/gemini-2.5-flash` | **推荐**：识图 + 情境文案（`/api/analyze`） |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash-image` | 仅 `/api/annotate` 整图生成（不推荐） |
| `OPENROUTER_IMAGE_STRENGTH` | `0.18` | 仅 **Recraft** 模型 |

客户端「云端大模型改图」现已改为：**云端识图 → 本地沿边缘描线 + 叠加文案**，效果远好于整图重绘。

若仍想尝试整图生成，可调用 `POST /api/annotate`；或调整：

```toml
OPENROUTER_MODEL = "recraft/recraft-v3"
OPENROUTER_IMAGE_STRENGTH = "0.12"
```

（Recraft 对中文手写字支持可能弱于 Gemini，请自行对比。）

## 7. 回退到 Replicate

```toml
IMAGE_PROVIDER = "replicate"
REPLICATE_MODEL = "black-forest-labs/flux-kontext-dev"
```

```bash
npx wrangler secret put REPLICATE_API_TOKEN
```

## 8. API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ provider, analyzeModel, mode }` |
| POST | `/api/analyze` | 上传 `image`；返回 `{ analysis: { elements, labels } }`（推荐） |
| POST | `/api/annotate` | 上传 `image`；整图生成（旧路径，可能 `jobId` 需轮询） |
| GET | `/api/status?id=` | 查询任务 |
| GET | `/api/proxy-image?url=` | 仅 Replicate 外链图代理 |

## 9. 本地联调

```bash
cp .dev.vars.example .dev.vars
# 编辑 OPENROUTER_API_KEY
npm run dev
```

`_config.yml` 临时：`sketch_api_url: "http://127.0.0.1:8787"`
