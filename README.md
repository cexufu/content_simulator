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

接入 DeepSeek 后台：

```bash
cp .env.example .env
```

把 `.env` 里的 `DEEPSEEK_API_KEY` 换成真实 Key，然后运行：

```bash
npm start
```

访问 `http://localhost:10006`。

## 模型配置

```bash
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
MODEL_NAME=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_STYLE=chat
MODEL_THINKING=enabled
MODEL_REASONING_EFFORT=high
PORT=10006
ALLOWED_ORIGIN=
```

- `DEEPSEEK_API_KEY`：只放在后端环境变量里，不要写进前端。
- `MODEL_NAME`：默认 `deepseek-v4-pro`，用于 thinking 模式。
- `MODEL_BASE_URL`：默认 `https://api.deepseek.com`。
- `MODEL_API_STYLE`：DeepSeek 使用 `chat`。
- `MODEL_THINKING`：默认 `enabled`，如需关闭可设为 `off`。
- `MODEL_REASONING_EFFORT`：默认 `high`。
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
DEEPSEEK_API_KEY=你的真实Key
MODEL_NAME=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_STYLE=chat
MODEL_THINKING=enabled
MODEL_REASONING_EFFORT=high
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

如果要换成其他 OpenAI-compatible 网关：

```bash
MODEL_API_KEY=你的网关Key
MODEL_NAME=你的模型名
MODEL_BASE_URL=https://你的网关域名/v1
MODEL_API_STYLE=chat
```

这样前端和后端仍然不用改代码。

## API

- `POST /api/resolve-url`：尝试读取网页摘要；抖音主页读取受限时返回明确提示。
- `POST /api/analyze`：分析原稿，返回文风画像。
- `POST /api/refine-profile`：根据用户反馈校准画像。
- `POST /api/generate`：根据画像和任务生成初稿。
- `POST /api/revise`：根据修改意见改稿。
- `POST /api/generate-stream`：流式生成初稿，返回正文和 thinking。
- `POST /api/revise-stream`：流式改稿，返回正文和 thinking。

## 当前边界

- TXT、Markdown、HTML 文件会在浏览器内读取。
- PDF、Word、抖音主页链接会被记录，并预留后端连接器状态。
- 普通网页链接会由后端尝试读取标题、描述和可见文本。
- 抖音主页完整作品列表通常需要抖音开放平台授权、专门连接器，或用户粘贴/导入作品标题、文案、标签和互动数据。
