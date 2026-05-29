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
curl -sS "https://ejgemmhyeeuiudhqlioc.supabase.co/functions/v1/sketch-annotate-proxy/api/health"
```

应返回 `{"ok":true,...}`。

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
