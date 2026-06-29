# Content Simulator

一个静态版内容风格学习工具，用于演示三步流程：

1. 原稿收集
2. 风格确认
3. 成稿交付

## 本地运行

```bash
python3 -m http.server 10006 --directory .
```

然后访问 `http://localhost:10006`。

## 当前边界

- TXT、Markdown、HTML 文件会在浏览器内读取。
- PDF、Word、抖音主页链接会被记录，并预留后端连接器状态。
- 大模型与抖音主页读取需要后端代理，不应把 API Key 放在前端。
