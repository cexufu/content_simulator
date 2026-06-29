# Content Simulator

内容风格学习工具，用于三步流程：

1. 原稿收集
2. 风格确认
3. 成稿交付

## 本地运行

静态预览：

```bash
python3 -m http.server 10006 --directory .
```

然后访问 `http://localhost:10006`。

接入 OpenAI 后台：

```bash
cp .env.example .env
```

把 `.env` 里的 `OPENAI_API_KEY` 换成真实 Key，然后运行：

```bash
npm start
```

访问 `http://localhost:10006`。

## OpenAI 配置

```bash
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.5
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_STYLE=responses
PORT=10006
ALLOWED_ORIGIN=
```

- `OPENAI_API_KEY`：只放在后端环境变量里，不要写进前端。
- `OPENAI_MODEL`：默认 `gpt-5.5`，如果账号不可用，可以换成你有权限的模型。
- `OPENAI_BASE_URL`：默认官方 OpenAI；也可以换成 OpenAI-compatible 网关。
- `OPENAI_API_STYLE`：官方 Responses API 用 `responses`；大多数兼容网关用 `chat`。
- `ALLOWED_ORIGIN`：如果前端部署在 GitHub Pages、后端部署在其他域名，可设置为 GitHub Pages 地址。

如果 GitHub Pages 前端要连接独立后端，首次访问时可以带上：

```text
https://cexufu.github.io/content_simulator/?api=https://your-backend.example.com
```

这个后端地址会保存在当前浏览器本地。

## 今天上线建议：国内可访问

最快方式是把整个仓库部署成一个 Node 服务，让同一个域名同时承载网页和 `/api/*` 后端。

不建议把真实产品只放在 GitHub Pages，因为 GitHub Pages 不能运行后端，也不能安全保存 Key。

推荐路径：

1. 买一台腾讯云或阿里云轻量服务器，优先选香港或新加坡节点。
2. 安装 Node.js 18+。
3. 拉取仓库：

```bash
git clone https://github.com/cexufu/content_simulator.git
cd content_simulator
```

4. 创建 `.env`，填入：

```bash
OPENAI_API_KEY=你的真实Key
OPENAI_MODEL=gpt-5.5
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_STYLE=responses
PORT=10006
```

5. 启动：

```bash
npm install
npm start
```

6. 访问：

```text
http://服务器IP:10006
```

如果服务器不能访问官方 OpenAI，可以换成 OpenAI-compatible 网关：

```bash
OPENAI_API_KEY=你的网关Key
OPENAI_MODEL=你的模型名
OPENAI_BASE_URL=https://你的网关域名/v1
OPENAI_API_STYLE=chat
```

这样前端和后端仍然不用改代码。

## API

- `POST /api/analyze`：分析原稿，返回文风画像。
- `POST /api/refine-profile`：根据用户反馈校准画像。
- `POST /api/generate`：根据画像和任务生成初稿。
- `POST /api/revise`：根据修改意见改稿。

## 当前边界

- TXT、Markdown、HTML 文件会在浏览器内读取。
- PDF、Word、抖音主页链接会被记录，并预留后端连接器状态。
- 抖音主页读取仍需要单独连接器；当前后端先接 OpenAI 文风学习与生成。
