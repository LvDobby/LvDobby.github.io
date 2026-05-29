# sketch-annotate-proxy（Supabase Edge Function）

国内访问 `*.workers.dev` 常出现 `ERR_CERT_COMMON_NAME_INVALID`（DNS 污染 / 证书劫持）。  
浏览器改请求本函数（`*.supabase.co`），由 Edge 在服务端转发到 Cloudflare Worker。

## 部署（一次性）

1. 安装 CLI：`npm i -g supabase` 或 `brew install supabase/tap/supabase`
2. 登录：`supabase login`
3. 在项目根目录执行：

```bash
cd /path/to/LvDobby.github.io
supabase functions deploy sketch-annotate-proxy \
  --project-ref ejgemmhyeeuiudhqlioc \
  --no-verify-jwt
```

4. 验证：

```bash
curl -sS "https://ejgemmhyeeuiudhqlioc.supabase.co/functions/v1/sketch-annotate-proxy?path=%2Fapi%2Fhealth"
curl -sS -X POST "https://ejgemmhyeeuiudhqlioc.supabase.co/functions/v1/sketch-annotate-proxy?path=%2Fapi%2Fannotate" \
  -F "image=@img/aboutme01.jpg" -F "model=bytedance-seed/seedream-4.5"
```

应返回 `{"ok":true,...}` 与生图 JSON。

> Supabase 不会把 `/api/annotate` 子路径传给函数，前端通过 `?path=/api/annotate` 指定 Worker 路由。

## 可选密钥

```bash
supabase secrets set SKETCH_WORKER_URL=https://sketch-annotate-api.lvdobby.workers.dev
```

## 前端配置

`_config.yml`：

```yaml
sketch_api_url: "https://ejgemmhyeeuiudhqlioc.supabase.co/functions/v1/sketch-annotate-proxy"
```

用户「高级设置」里若仍填 `workers.dev`，页面会自动改回 Supabase 代理地址。

## 国内登录 / 统计（Supabase REST 代理）

无梯子时浏览器直连 `*.supabase.co/rest/v1` 可能超时或被干扰。  
前端已自动把 Supabase **REST** 请求改走同一 Edge Function：

`?path=/supabase/rest/v1/...`

**Auth / OAuth（`/auth/v1/*`）必须直连**，不能走代理，否则 OAuth 302 重定向会被吞掉导致 GitHub 登录卡住。

与生图 API 共用 `sketch_api_url`，无需额外配置。部署新版本 Edge Function 后即可生效。
