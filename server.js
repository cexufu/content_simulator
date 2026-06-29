const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

loadEnv();

const PORT = Number(process.env.PORT || 10006);
const MODEL_API_KEY = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL_NAME = process.env.MODEL_NAME || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-v4-pro";
const MODEL_BASE_URL = trimTrailingSlash(
  process.env.MODEL_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
);
const MODEL_API_STYLE = process.env.MODEL_API_STYLE || process.env.OPENAI_API_STYLE || "chat";
const MODEL_THINKING = process.env.MODEL_THINKING || "enabled";
const MODEL_REASONING_EFFORT = process.env.MODEL_REASONING_EFFORT || "high";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const ROOT = __dirname;
const BODY_LIMIT = 12 * 1024 * 1024;
const PUBLIC_FILES = new Set(["/index.html", "/app.js", "/styles.css"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml"
};

const toneAxes = ["理性", "亲近", "锋利", "克制", "故事感", "行动感"];

const server = http.createServer(async (req, res) => {
  try {
    if (handleCors(req, res)) return;

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(MODEL_API_KEY),
        model: MODEL_NAME,
        apiStyle: MODEL_API_STYLE,
        thinking: MODEL_THINKING,
        baseUrl: maskBaseUrl(MODEL_BASE_URL)
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url.pathname);
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "服务器开小差了，请稍后再试。" });
  }
});

server.listen(PORT, () => {
  console.log(`Content Simulator running at http://localhost:${PORT}`);
});

async function handleApi(req, res, pathname) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const payload = await readJsonBody(req);
  if (pathname === "/api/resolve-url") return resolveUrl(req, res, payload);
  if (pathname === "/api/parse-file") return parseFile(req, res, payload);

  if (!MODEL_API_KEY) {
    return sendJson(res, 503, { error: "MODEL_API_KEY or DEEPSEEK_API_KEY is not configured" });
  }

  if (pathname === "/api/analyze") return analyze(req, res, payload);
  if (pathname === "/api/refine-profile") return refineProfile(req, res, payload);
  if (pathname === "/api/generate") return generateDraft(req, res, payload);
  if (pathname === "/api/revise") return reviseDraft(req, res, payload);
  if (pathname === "/api/generate-stream") return generateDraftStream(req, res, payload);
  if (pathname === "/api/revise-stream") return reviseDraftStream(req, res, payload);
  return sendJson(res, 404, { error: "API not found" });
}

async function resolveUrl(_req, res, payload) {
  const rawUrl = String(payload.url || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_error) {
    return sendJson(res, 400, { error: "链接格式不正确" });
  }

  const isDouyin = /(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$|v\.douyin\.com$/i.test(parsedUrl.hostname);
  const isEeoArticle = isEeoArticleUrl(parsedUrl);
  try {
    const page = await fetchPublicPage(parsedUrl.href);
    const title = page.title || (isDouyin ? "抖音主页或作品链接" : "网页链接");
    const body = page.text.trim();
    if (isDouyin && body.length < 800) {
      return sendJson(res, 200, buildDouyinLimitedSource(parsedUrl.href, title));
    }
    if (body.length < 120 || isLikelyShellPage(body, title)) {
      if (isEeoArticle) {
        const eeoSource = await fetchEeoArticleFallback(parsedUrl).catch(() => null);
        if (eeoSource) return sendJson(res, 200, eeoSource);
      }
      return sendJson(res, 200, buildLimitedWebSource(parsedUrl.href, title, "页面正文可能由前端动态渲染，当前没有读取到足够正文。"));
    }
    return sendJson(res, 200, {
      type: isDouyin ? "douyin" : "url",
      title,
      url: parsedUrl.href,
      body: body.slice(0, 8000),
      status: isDouyin ? "已读取公开页面摘要" : "已读取网页摘要",
      limited: false
    });
  } catch (error) {
    if (isDouyin) {
      return sendJson(res, 200, buildDouyinLimitedSource(parsedUrl.href, "抖音主页或作品链接"));
    }
    if (isEeoArticle) {
      const eeoSource = await fetchEeoArticleFallback(parsedUrl).catch(() => null);
      if (eeoSource) return sendJson(res, 200, eeoSource);
    }
    return sendJson(res, 200, buildLimitedWebSource(parsedUrl.href, "网页链接", `当前后端没有读取到正文。错误：${error.message}`));
  }
}

async function parseFile(_req, res, payload) {
  const name = String(payload.name || "未命名文件").slice(0, 180);
  const extension = String(payload.extension || path.extname(name).replace(".", "") || "").toLowerCase();
  const base64 = String(payload.data || "");
  if (!base64) {
    return sendJson(res, 400, { error: "没有收到文件内容" });
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (_error) {
    return sendJson(res, 400, { error: "文件内容格式不正确" });
  }

  try {
    if (extension === "docx") {
      const body = extractDocxText(buffer);
      return sendJson(res, 200, {
        type: "docx",
        title: name,
        body: body.slice(0, 24000),
        status: `已解析 · ${body.length}字`,
        limited: false
      });
    }

    if (["html", "htm"].includes(extension)) {
      const html = decodeBufferText(buffer);
      const page = extractHtmlSummary(html);
      const body = page.text.trim();
      if (!body) throw new Error("HTML 中没有读取到正文");
      return sendJson(res, 200, {
        type: extension,
        title: name,
        body: body.slice(0, 24000),
        status: `已读取 · ${body.length}字`,
        limited: false
      });
    }

    if (["txt", "md"].includes(extension)) {
      const body = decodeBufferText(buffer).trim();
      if (!body) throw new Error("文件为空");
      return sendJson(res, 200, {
        type: extension,
        title: name,
        body: body.slice(0, 24000),
        status: `已读取 · ${body.length}字`,
        limited: false
      });
    }

    return sendJson(res, 200, {
      type: extension || "file",
      title: name,
      body: "文件已记录，但当前只支持自动解析 docx、txt、md、html。PDF 和旧版 doc 请先转成 docx 或粘贴正文。",
      status: "格式暂不支持，需补充正文",
      limited: true
    });
  } catch (error) {
    return sendJson(res, 200, {
      type: extension || "file",
      title: name,
      body: `文件已记录，但没有解析出正文。错误：${error.message}`,
      status: "解析失败，需粘贴正文",
      limited: true
    });
  }
}

function extractDocxText(buffer) {
  const entries = unzipEntries(buffer);
  const xmlNames = Object.keys(entries).filter((name) => {
    return (
      name === "word/document.xml" ||
      /^word\/(header|footer)\d+\.xml$/.test(name) ||
      ["word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"].includes(name)
    );
  });
  const text = xmlNames
    .map((name) => extractDocxXmlText(entries[name].toString("utf8")))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new Error("DOCX 中没有读取到正文");
  return text;
}

function unzipEntries(buffer) {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("不是有效的 DOCX 文件");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = {};
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) {
      entries[name] = compressed;
    } else if (method === 8) {
      entries[name] = zlib.inflateRawSync(compressed);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findZipEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extractDocxXmlText(xml) {
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .split(/<\/w:p>/)
    .map((paragraph) => {
      const runs = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeHtml(match[1]));
      return runs.join("");
    })
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeBufferText(buffer) {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, 4096));
  const charset = detectCharset("", head);
  return new TextDecoder(charset, { fatal: false }).decode(buffer);
}

async function fetchPublicPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const buffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const head = new TextDecoder("utf-8", { fatal: false }).decode(uint8.slice(0, 4096));
    const charset = detectCharset(contentType, head);
    const html = new TextDecoder(charset, { fatal: false }).decode(uint8);
    return extractHtmlSummary(html);
  } finally {
    clearTimeout(timer);
  }
}

function extractHtmlSummary(html) {
  const title = decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const description = decodeHtml(
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)?.[1] ||
      "").trim()
  );
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  return {
    title,
    text: [title, description, text].filter(Boolean).join("\n\n").slice(0, 12000)
  };
}

function detectCharset(contentType, htmlHead) {
  const fromHeader = contentType.match(/charset=([^;\s]+)/i)?.[1];
  const fromMeta =
    htmlHead.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/i)?.[1] ||
    htmlHead.match(/<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i)?.[1];
  const raw = String(fromHeader || fromMeta || "utf-8").toLowerCase().replace(/["']/g, "");
  if (raw.includes("gb2312") || raw.includes("gbk") || raw.includes("gb18030")) return "gb18030";
  if (raw.includes("utf8") || raw.includes("utf-8")) return "utf-8";
  return raw;
}

function isLikelyShellPage(body, title) {
  const compact = body.replace(/\s+/g, "");
  const compactTitle = String(title || "").replace(/\s+/g, "");
  if (!compact) return true;
  if (compactTitle && compact === compactTitle.repeat(Math.max(1, Math.floor(compact.length / compactTitle.length)))) return true;
  return compact.length < 80;
}

function isEeoArticleUrl(parsedUrl) {
  return /(^|\.)eeo\.com\.cn$/i.test(parsedUrl.hostname) && /\/article\/info/i.test(parsedUrl.pathname) && parsedUrl.searchParams.has("id");
}

async function fetchEeoArticleFallback(parsedUrl) {
  const articleId = parsedUrl.searchParams.get("id");
  if (!articleId) return null;

  const form = new URLSearchParams({
    id: articleId,
    customerUuid: "",
    publishChannels: "",
    action: "2",
    channelUuid: parsedUrl.searchParams.get("channelUuid") || "",
    requestType: "",
    language: "zh-Hans",
    appName: "eeoLocal"
  });

  const response = await fetch("https://jg-jgxw.eeo.com.cn/api/homePage/v0/toArticleShare/web", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "Accept": "application/json,text/plain,*/*",
      "Origin": "https://jg-mvvm.eeo.com.cn",
      "Referer": parsedUrl.href
    },
    body: form.toString()
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const json = await response.json();
  const data = json.data || {};
  const title = cleanText(data.titleText || data.titleCon || "经观文章");
  if (!title && !data.imgUrl) return null;

  return {
    type: "url",
    title: title || "经观文章",
    url: parsedUrl.href,
    body: [
      "经观链接已识别，并读取到文章标题。",
      title ? `标题：${title}` : "",
      data.imgUrl ? `封面：${data.imgUrl}` : "",
      "正文由经观前端接口动态加载，当前没有拿到完整正文。请粘贴正文后继续分析。"
    ].filter(Boolean).join("\n"),
    status: "已读取标题，正文受限",
    limited: true
  };
}

function buildDouyinLimitedSource(url, title) {
  return {
    type: "douyin",
    title,
    url,
    body: [
      "抖音主页链接已记录，但公开网页通常不会直接暴露完整作品列表、播放量、点赞、评论、收藏和转发数据。",
      "要完成账号级学习，需要接入抖音开放平台授权、专门连接器，或由用户粘贴/导入作品标题、文案、标签和互动数据。",
      "当前仅能把该链接作为待补充材料，不会把它误判为已完整读取。"
    ].join("\n"),
    status: "抖音读取受限，需补充作品数据",
    limited: true
  };
}

function buildLimitedWebSource(url, title, reason) {
  return {
    type: "url",
    title,
    url,
    body: [
      "网页链接已记录，但没有读取到足够正文。",
      reason,
      "可以直接粘贴文章正文，或换一个可公开读取的网页链接。"
    ].join("\n"),
    status: "读取受限，需补充正文",
    limited: true
  };
}

async function analyze(_req, res, payload) {
  const sources = normalizeSources(payload.sources || []);
  const rules = normalizeRules(payload.rules || []);
  if (!hasReadableSources(sources)) {
    return sendJson(res, 422, {
      error: "没有读取到可分析正文。请粘贴文章正文，或使用可公开读取的新闻/文章链接。"
    });
  }
  const text = await callOpenAI({
    instructions: [
      "你是 Content Simulator 的文风分析后台。",
      "你需要阅读用户提供的原稿、文件摘要或账号链接记录，输出可被前端渲染的 JSON。",
      "请区分文本特征、视频特征和传播线索。若抖音链接尚未被真实爬取，请明确写出需要后端连接器补充。",
      "只输出 JSON，不要输出 Markdown。"
    ].join("\n"),
    input: JSON.stringify({
      task: "分析用户内容风格",
      expectedShape: profileShape(),
      sources,
      rules
    })
  });

  const profile = normalizeProfile(parseJson(text), rules);
  return sendJson(res, 200, { profile });
}

async function refineProfile(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const message = String(payload.message || "").slice(0, 2000);
  const rules = normalizeRules(payload.rules || []);
  const text = await callOpenAI({
    instructions: [
      "你是 Content Simulator 的文风校准后台。",
      "用户会指出画像哪里不像自己。请更新画像，并给一句简短回复。",
      "只输出 JSON，不要输出 Markdown。"
    ].join("\n"),
    input: JSON.stringify({
      task: "根据用户反馈校准文风画像",
      expectedShape: {
        profile: profileShape(),
        rules: ["规则1"],
        reply: "一句简短回复"
      },
      currentProfile: profile,
      currentRules: rules,
      userMessage: message
    })
  });

  const parsed = parseJson(text);
  const nextRules = normalizeRules(parsed.rules || [...rules, message]);
  const nextProfile = normalizeProfile(parsed.profile || parsed, nextRules);
  return sendJson(res, 200, {
    profile: nextProfile,
    rules: nextRules,
    reply: parsed.reply || "已按你的反馈校准。"
  });
}

async function generateDraft(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const task = String(payload.task || "").slice(0, 4000);
  const type = String(payload.type || "内容").slice(0, 100);
  const text = await callOpenAI({
    instructions: [
      "你是 Content Simulator 的成稿后台。",
      "请基于已确认的文风画像和额外规则写初稿。",
      "文案要像内容创作者本人继续写，不要解释你是 AI。",
      "只输出 JSON，不要输出 Markdown。"
    ].join("\n"),
    input: JSON.stringify({
      task: "生成初稿",
      expectedShape: {
        draft: "完整初稿文本",
        reply: "一句简短回复"
      },
      contentType: type,
      userTask: task,
      profile,
      rules
    })
  });

  const parsed = parseJson(text);
  return sendJson(res, 200, {
    draft: String(parsed.draft || text).trim(),
    reply: parsed.reply || "初稿已生成。"
  });
}

async function generateDraftStream(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const task = String(payload.task || "").slice(0, 4000);
  const type = String(payload.type || "内容").slice(0, 100);
  sendSseHeaders(res);
  try {
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的成稿后台。",
        "请基于已确认的文风画像和额外规则写初稿。",
        "文案要像内容创作者本人继续写，不要解释你是 AI。",
        "直接输出完整稿件正文，不要输出 JSON，不要输出 Markdown 代码块。"
      ].join("\n"),
      input: JSON.stringify({
        task: "生成初稿",
        contentType: type,
        userTask: task,
        profile,
        rules
      }),
      onThinking: (text) => writeSse(res, "thinking", { text }),
      onContent: (text) => writeSse(res, "content", { text })
    });
    writeSse(res, "done", { ok: true });
  } catch (error) {
    writeSse(res, "error", { error: error.message || "生成失败" });
  } finally {
    res.end();
  }
}

async function reviseDraft(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const draft = String(payload.draft || "").slice(0, 12000);
  const instruction = String(payload.instruction || "").slice(0, 2000);
  const text = await callOpenAI({
    instructions: [
      "你是 Content Simulator 的改稿后台。",
      "请根据用户新意见修改当前稿件，保留已确认文风。",
      "只输出 JSON，不要输出 Markdown。"
    ].join("\n"),
    input: JSON.stringify({
      task: "修改稿件",
      expectedShape: {
        draft: "修改后的完整稿件",
        reply: "一句简短回复"
      },
      currentDraft: draft,
      instruction,
      profile,
      rules
    })
  });

  const parsed = parseJson(text);
  return sendJson(res, 200, {
    draft: String(parsed.draft || text).trim(),
    reply: parsed.reply || "已按你的意见修改。"
  });
}

async function reviseDraftStream(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const draft = String(payload.draft || "").slice(0, 12000);
  const instruction = String(payload.instruction || "").slice(0, 2000);
  sendSseHeaders(res);
  try {
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的改稿后台。",
        "请根据用户新意见修改当前稿件，保留已确认文风。",
        "直接输出修改后的完整稿件正文，不要输出 JSON，不要输出 Markdown 代码块。"
      ].join("\n"),
      input: JSON.stringify({
        task: "修改稿件",
        currentDraft: draft,
        instruction,
        profile,
        rules
      }),
      onThinking: (text) => writeSse(res, "thinking", { text }),
      onContent: (text) => writeSse(res, "content", { text })
    });
    writeSse(res, "done", { ok: true });
  } catch (error) {
    writeSse(res, "error", { error: error.message || "改稿失败" });
  } finally {
    res.end();
  }
}

async function callOpenAI({ instructions, input }) {
  if (MODEL_API_STYLE === "chat") {
    return callChatCompletions({ instructions, input });
  }
  return callResponses({ instructions, input });
}

async function callResponses({ instructions, input }) {
  const response = await fetch(`${MODEL_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MODEL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      instructions,
      input
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `OpenAI request failed: ${response.status}`;
    throw new Error(message);
  }
  return extractOutputText(data);
}

async function callChatCompletions({ instructions, input }) {
  const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MODEL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      ...buildThinkingOptions(),
      stream: false
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `OpenAI-compatible request failed: ${response.status}`;
    throw new Error(message);
  }
  return data.choices?.[0]?.message?.content || "";
}

async function callChatCompletionsStream({ instructions, input, onThinking, onContent }) {
  if (MODEL_API_STYLE !== "chat") {
    throw new Error("Streaming currently requires MODEL_API_STYLE=chat");
  }
  const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MODEL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      ...buildThinkingOptions(),
      stream: true
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.error?.message || `Streaming request failed: ${response.status}`;
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const data = JSON.parse(payload);
      const delta = data.choices?.[0]?.delta || {};
      if (delta.reasoning_content) onThinking(delta.reasoning_content);
      if (delta.content) onContent(delta.content);
    }
  }
}

function buildThinkingOptions() {
  if (!MODEL_THINKING || MODEL_THINKING === "off") return {};
  return {
    thinking: {
      type: MODEL_THINKING,
      reasoning_effort: MODEL_REASONING_EFFORT
    }
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n").trim();
}

function parseJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch (_nestedError) {
      return {};
    }
  }
}

function normalizeSources(sources) {
  let total = 0;
  return sources.slice(0, 24).map((source) => {
    const limited = Boolean(source.limited) || /读取受限|需补充|待后端/.test(source.status || "");
    const body = limited ? "" : String(source.body || "").slice(0, Math.max(0, 24000 - total));
    total += body.length;
    return {
      type: source.type || "text",
      title: String(source.title || "未命名材料").slice(0, 160),
      status: source.status || "",
      url: source.url || "",
      body,
      limited
    };
  });
}

function hasReadableSources(sources) {
  return sources.some((source) => source.body && !source.limited);
}

function normalizeProfile(profile, rules = []) {
  const normalized = {
    confidence: ["高", "中", "待补充"].includes(profile.confidence) ? profile.confidence : "中",
    tones: {},
    domains: normalizeDomains(profile.domains),
    keywords: normalizeKeywords(profile.keywords),
    contentFeatures: normalizeList(profile.contentFeatures, ["主题重心待继续学习"]),
    textFeatures: normalizeList(profile.textFeatures, ["文本节奏待继续学习"]),
    videoFeatures: normalizeList(profile.videoFeatures, ["视频账号数据待后端连接器补充"]),
    trafficFeatures: normalizeList(profile.trafficFeatures, ["传播线索待更多样本补充"]),
    rules: normalizeRules(profile.rules || rules),
    updatedAt: new Date().toISOString()
  };

  for (const axis of toneAxes) {
    const value = Number(profile.tones?.[axis]);
    normalized.tones[axis] = Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 50;
  }
  return normalized;
}

function normalizeDomains(domains) {
  const fallback = [
    { name: "内容创作", percent: 40 },
    { name: "品牌传播", percent: 25 },
    { name: "科技产品", percent: 20 },
    { name: "职场经验", percent: 15 }
  ];
  const items = Array.isArray(domains) ? domains : fallback;
  return items.slice(0, 5).map((item, index) => ({
    name: String(item.name || fallback[index]?.name || "其他").slice(0, 20),
    percent: clamp(Math.round(Number(item.percent || item.value || 10)), 1, 100)
  }));
}

function normalizeKeywords(keywords) {
  return (Array.isArray(keywords) ? keywords : [])
    .slice(0, 16)
    .map((item) => ({
      word: String(item.word || item.name || item).slice(0, 20),
      count: Math.max(1, Math.round(Number(item.count || item.value || 1)))
    }))
    .filter((item) => item.word);
}

function normalizeRules(rules) {
  const items = Array.isArray(rules) ? rules : String(rules || "").split(/[;\n；。]/);
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean))).slice(0, 24);
}

function normalizeList(value, fallback) {
  const list = Array.isArray(value) ? value : [];
  const normalized = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  return normalized.length ? normalized : fallback;
}

function profileShape() {
  return {
    confidence: "高|中|待补充",
    tones: {
      "理性": 0,
      "亲近": 0,
      "锋利": 0,
      "克制": 0,
      "故事感": 0,
      "行动感": 0
    },
    domains: [{ name: "领域名称", percent: 50 }],
    keywords: [{ word: "关键词", count: 3 }],
    contentFeatures: ["内容特征"],
    textFeatures: ["文本风格"],
    videoFeatures: ["视频特征"],
    trafficFeatures: ["传播线索"],
    rules: ["额外规则"]
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function maskBaseUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return "custom";
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function cleanText(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function handleCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin && (ALLOWED_ORIGIN === "*" || ALLOWED_ORIGIN === origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  if (!PUBLIC_FILES.has(requested) && !requested.startsWith("/assets/")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendSseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
