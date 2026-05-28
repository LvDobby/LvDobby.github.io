# sketch-annotate-api（Cloudflare Workers）

为 [生活手绘注释图](/sketch-annotate.html) 提供云端图像编辑代理。**默认使用豆包 Seedream**（`bytedance-seed/seedream-4.5`，经 OpenRouter 调用），在原图基础上叠加手绘注释；异步 KV 任务避免生成超时。

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
| `OPENROUTER_MODEL` | `bytedance-seed/seedream-4.5` | **默认**：豆包 Seedream 图生图/编辑（`/api/annotate`） |
| `OPENROUTER_FALLBACK_MODEL` | （空） | 可选备用模型 |
| `OPENROUTER_ANALYZE_MODEL` | `google/gemini-2.5-flash` | 可选：识图 + 文案（`/api/analyze`） |
| `OPENROUTER_IMAGE_STRENGTH` | `0.12` | 仅 **Recraft** 模型 |

若需改用 Recraft 或 Gemini 图像模型：

```toml
OPENROUTER_MODEL = "recraft/recraft-v3"
# 或 OPENROUTER_MODEL = "google/gemini-2.5-flash-image"
```

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
| GET | `/api/health` | `{ provider, model, mode }` |
| POST | `/api/annotate` | 上传 `image`；返回 `imageDataUrl` 或 `jobId` 需轮询（默认） |
| POST | `/api/analyze` | 上传 `image`；返回 `{ analysis }`（可选混合模式） |
| GET | `/api/status?id=` | 查询任务 |
| GET | `/api/proxy-image?url=` | 仅 Replicate 外链图代理 |

## 9. 本地联调

```bash
cp .dev.vars.example .dev.vars
# 编辑 OPENROUTER_API_KEY
npm run dev
```

`_config.yml` 临时：`sketch_api_url: "http://127.0.0.1:8787"`
