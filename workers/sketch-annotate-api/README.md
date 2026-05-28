# sketch-annotate-api（Cloudflare Workers）

为 [生活手绘注释图](/sketch-annotate.html) 提供 **Replicate 图生图** 代理，API Key 仅存 Cloudflare，浏览器只访问 `*.workers.dev`（无需备案域名）。

## 1. 前置条件

1. 注册 [Cloudflare](https://dash.cloudflare.com/)（免费即可）
2. 注册 [Replicate](https://replicate.com/) 并创建 API Token
3. 本机安装 Node.js 18+

## 2. 安装与登录

**重要：** 必须在 Worker 目录或 `workers/` 目录安装，**不要**在博客仓库根目录执行 `npm install`（根目录是旧的 Grunt 博客构建依赖，会装错包）。

```bash
# 方式 A（推荐）：在 workers 目录用 workspace 安装
cd workers
npm install

# 方式 B：直接进入子项目
cd workers/sketch-annotate-api
npm install

npx wrangler login
```

## 3. 配置密钥与余额

1. 在 [Replicate Billing](https://replicate.com/account/billing) **充值**（`flux-kontext-dev` 按次计费，余额不足会返回 402）
2. 在 [API Tokens](https://replicate.com/account/api-tokens) 创建 Token，然后：

```bash
npx wrangler secret put REPLICATE_API_TOKEN
# 粘贴 r8_xxx...

# 可选：防止他人刷你的额度（前端高级设置里填同一令牌）
npx wrangler secret put ANNOTATE_TOKEN
```

## 4. 部署

```bash
npm run deploy
```

终端会输出类似：

```text
Published sketch-annotate-api (x.x xs)
  https://sketch-annotate-api.<你的子域>.workers.dev
```

记下该 URL（**不要**末尾斜杠）。

## 5. 关联博客站点

编辑仓库根目录 `_config.yml`：

```yaml
sketch_api_url: "https://sketch-annotate-api.<你的子域>.workers.dev"
```

推送后 GitHub Pages 重建，打开「生活手绘注释图」页，选择 **云端大模型改图** 即可。

若设置了 `ANNOTATE_TOKEN`，在页面「高级设置」填写 **Worker 访问令牌**（仅存浏览器 sessionStorage）。

## 6. 本地联调

终端 A — Worker：

```bash
cd workers/sketch-annotate-api
cp .dev.vars.example .dev.vars   # 填入 REPLICATE_API_TOKEN
npm run dev
# 默认 http://127.0.0.1:8787
```

终端 B — Jekyll：

```bash
bundle exec jekyll serve
```

`_config.yml` 中临时改为：

```yaml
sketch_api_url: "http://127.0.0.1:8787"
```

`wrangler.toml` 的 `ALLOWED_ORIGINS` 已包含 `http://127.0.0.1:4000`。

## 7. API 说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/annotate` | `multipart/form-data`，字段 `image`；返回 `{ jobId, status }` |
| GET | `/api/status?id=` | 轮询任务；成功时 `{ status, imageUrl, proxyUrl }` |
| GET | `/api/proxy-image?url=` | 代理 Replicate 图片（解决下载跨域） |

## 8. 费用与限流

- Replicate 按模型运行时间计费，见 [flux-kontext-dev](https://replicate.com/black-forest-labs/flux-kontext-dev)
- 可在 Cloudflare Dashboard 为 Worker 设每日请求上限；建议务必配置 `ANNOTATE_TOKEN`
- 生成失败时前端会自动 **降级为浏览器本地手绘引擎**

## 9. 更换模型

修改 `wrangler.toml` 中 `REPLICATE_MODEL`（格式 `owner/name`），并确认该模型支持 `input_image` + `prompt`，必要时调整 `src/index.js` 的 `input` 字段。
