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
PORT=10006
ALLOWED_ORIGIN=
```

- `OPENAI_API_KEY`：只放在后端环境变量里，不要写进前端。
- `OPENAI_MODEL`：默认 `gpt-5.5`，如果账号不可用，可以换成你有权限的模型。
- `ALLOWED_ORIGIN`：如果前端部署在 GitHub Pages、后端部署在其他域名，可设置为 GitHub Pages 地址。

如果 GitHub Pages 前端要连接独立后端，首次访问时可以带上：

```text
https://cexufu.github.io/content_simulator/?api=https://your-backend.example.com
```

这个后端地址会保存在当前浏览器本地。

## 今天上线建议

最快方式是把整个仓库部署成一个 Node Web Service，让同一个域名同时承载网页和 `/api/*` 后端。

Render 部署步骤：

1. 进入 Render，选择 `New Web Service`。
2. 连接 GitHub 仓库 `cexufu/content_simulator`。
3. 选择 `main` 分支。
4. Build Command 使用 `npm install`。
5. Start Command 使用 `npm start`。
6. 添加环境变量：
   - `OPENAI_API_KEY`：填你的真实 Key。
   - `OPENAI_MODEL`：默认 `gpt-5.5`，如果账号无权限，换成你有权限的模型。
7. 部署完成后，直接访问 Render 提供的域名。

这个方式不需要 GitHub Pages，也不需要在前端暴露 Key。

## API

- `POST /api/analyze`：分析原稿，返回文风画像。
- `POST /api/refine-profile`：根据用户反馈校准画像。
- `POST /api/generate`：根据画像和任务生成初稿。
- `POST /api/revise`：根据修改意见改稿。

## 当前边界

- TXT、Markdown、HTML 文件会在浏览器内读取。
- PDF、Word、抖音主页链接会被记录，并预留后端连接器状态。
- 抖音主页读取仍需要单独连接器；当前后端先接 OpenAI 文风学习与生成。
