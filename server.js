const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

loadEnv();

const PORT = Number(process.env.PORT || 10006);
const MODEL_API_KEY = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL_NAME = process.env.MODEL_NAME || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-v4-flash";
const MODEL_BASE_URL = trimTrailingSlash(
  process.env.MODEL_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
);
const MODEL_API_STYLE = process.env.MODEL_API_STYLE || process.env.OPENAI_API_STYLE || "chat";
const MODEL_THINKING = process.env.MODEL_THINKING || "disabled";
const MODEL_REASONING_EFFORT = process.env.MODEL_REASONING_EFFORT || "low";
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 45000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const INVITE_CODES = parseInviteCodes(process.env.INVITE_CODES || process.env.ACCESS_CODES || "");
const INVITE_REQUIRED = INVITE_CODES.size > 0 || /^true$/i.test(process.env.INVITE_REQUIRED || "");
const ROOT = __dirname;
const BODY_LIMIT = 12 * 1024 * 1024;
const TOPHUB_CACHE_TTL_MS = Number(process.env.TOPHUB_CACHE_TTL_MS || 10 * 60 * 1000);
const TOPHUB_FETCH_TIMEOUT_MS = Number(process.env.TOPHUB_FETCH_TIMEOUT_MS || 6000);
const PUBLIC_PAGE_TIMEOUT_MS = Number(process.env.PUBLIC_PAGE_TIMEOUT_MS || 10000);
const ACCOUNT_DATA_DIR = process.env.ACCOUNT_DATA_DIR || path.join(ROOT, "data", "users");
const PUBLIC_FILES = new Set(["/index.html", "/app.js", "/styles.css"]);
let mammothModule = null;
const sessions = new Map();
const topHubCache = { expiresAt: 0, entries: [] };

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
        baseUrl: maskBaseUrl(MODEL_BASE_URL),
        inviteRequired: INVITE_REQUIRED
      });
    }

    if (url.pathname === "/api/auth/me") {
      const session = getAuthSession(req);
      return sendJson(res, 200, {
        required: INVITE_REQUIRED,
        authenticated: Boolean(session || !INVITE_REQUIRED),
        inviteCode: session?.inviteCode || ""
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
  if (pathname === "/api/auth/login") return loginWithInvite(req, res, payload);
  if (pathname === "/api/auth/logout") return logout(req, res);

  const session = getAuthSession(req);
  if (INVITE_REQUIRED && !session) {
    return sendJson(res, 401, { error: "请先输入邀请码进入体验。" });
  }

  if (pathname === "/api/account/load") return loadAccountState(req, res, session);
  if (pathname === "/api/account/save") return saveAccountState(req, res, session, payload);
  if (pathname === "/api/account/clear") return clearAccountState(req, res, session);

  if (pathname === "/api/resolve-url") return resolveUrl(req, res, payload);
  if (pathname === "/api/related-info") return relatedInfo(req, res, payload);
  if (pathname === "/api/parse-file") return parseFile(req, res, payload);

  if (!MODEL_API_KEY) {
    return sendJson(res, 503, { error: "MODEL_API_KEY or DEEPSEEK_API_KEY is not configured" });
  }

  if (pathname === "/api/analyze") return analyze(req, res, payload);
  if (pathname === "/api/refine-profile") return refineProfile(req, res, payload);
  if (pathname === "/api/generate") return generateDraft(req, res, payload);
  if (pathname === "/api/revise") return reviseDraft(req, res, payload);
  if (pathname === "/api/generate-stream") return generateDraftStream(req, res, payload);
  if (pathname === "/api/workflow-stream") return generateWorkflowStream(req, res, payload);
  if (pathname === "/api/hotspot-topics") return generateHotspotTopics(req, res, payload);
  if (pathname === "/api/revise-stream") return reviseDraftStream(req, res, payload);
  return sendJson(res, 404, { error: "API not found" });
}

async function loadAccountState(_req, res, session) {
  const account = getAccountState(session.inviteCode);
  return sendJson(res, 200, {
    ok: true,
    exists: Boolean(account),
    inviteCode: session.inviteCode,
    state: account?.state || null,
    updatedAt: account?.updatedAt || null
  });
}

async function saveAccountState(_req, res, session, payload) {
  const state = sanitizeAccountState(payload.state);
  if (!state) return sendJson(res, 400, { error: "账号资料格式不正确。" });
  const saved = writeAccountState(session.inviteCode, state);
  return sendJson(res, 200, { ok: true, inviteCode: session.inviteCode, updatedAt: saved.updatedAt });
}

async function clearAccountState(_req, res, session) {
  const filePath = getAccountStatePath(session.inviteCode);
  fs.rmSync(filePath, { force: true });
  return sendJson(res, 200, { ok: true, inviteCode: session.inviteCode });
}

function getAccountState(inviteCode) {
  const filePath = getAccountStatePath(inviteCode);
  if (!fs.existsSync(filePath)) return null;
  try {
    const account = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!account || typeof account !== "object") return null;
    return {
      state: sanitizeAccountState(account.state) || {},
      updatedAt: account.updatedAt || null
    };
  } catch (error) {
    console.warn("Failed to read account state", error);
    return null;
  }
}

function writeAccountState(inviteCode, state) {
  const filePath = getAccountStatePath(inviteCode);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    inviteCode,
    updatedAt: new Date().toISOString(),
    state
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
  return payload;
}

function getAccountStatePath(inviteCode) {
  const safeCode = safeAccountId(inviteCode);
  return path.join(ACCOUNT_DATA_DIR, safeCode, "state.json");
}

function safeAccountId(value) {
  return normalizeInviteCode(value || "open").replace(/[^A-Z0-9_-]/g, "_") || "open";
}

function sanitizeAccountState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = new Set([
    "accepted",
    "currentStep",
    "sources",
    "profile",
    "rules",
    "focusNotes",
    "currentWorkbench",
    "selectedTopic",
    "initialDraft",
    "evaluation",
    "draft",
    "finalized",
    "thinking",
    "profileChat",
    "deliverChat",
    "workflowMode",
    "workflowStage",
    "knowledgeNotes",
    "relatedItems",
    "relatedStatus"
  ]);
  const state = {};
  for (const [key, item] of Object.entries(value)) {
    if (allowed.has(key)) state[key] = item;
  }
  if (Array.isArray(state.sources)) state.sources = state.sources.slice(0, 80);
  if (Array.isArray(state.rules)) state.rules = state.rules.slice(0, 80);
  if (Array.isArray(state.profileChat)) state.profileChat = state.profileChat.slice(-40);
  if (Array.isArray(state.deliverChat)) state.deliverChat = state.deliverChat.slice(-40);
  if (Array.isArray(state.relatedItems)) state.relatedItems = state.relatedItems.slice(0, 12);
  return state;
}

function loginWithInvite(req, res, payload) {
  if (!INVITE_REQUIRED) {
    const token = createSession("open");
    return sendJson(
      res,
      200,
      { ok: true, token, inviteCode: "open", required: false },
      { "Set-Cookie": buildSessionCookie(req, token) }
    );
  }

  const inviteCode = normalizeInviteCode(payload.inviteCode);
  if (!inviteCode || !INVITE_CODES.has(inviteCode)) {
    return sendJson(res, 401, { error: "邀请码不正确，请确认后重试。" });
  }

  const token = createSession(inviteCode);
  return sendJson(
    res,
    200,
    { ok: true, token, inviteCode, required: true },
    { "Set-Cookie": buildSessionCookie(req, token) }
  );
}

function logout(req, res) {
  const token = getAuthToken(req);
  if (token) sessions.delete(token);
  return sendJson(res, 200, { ok: true }, { "Set-Cookie": "cs_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly" });
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

async function relatedInfo(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const focusProfile = normalizeFocusProfile(payload.focusProfile || {});
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const keywords = String(payload.keywords || payload.query || "").slice(0, 1000).trim();
  const userSignals = buildHotspotUserSignals(profile, focusProfile, rules, keywords);
  if (!hasHotspotUserSignals(userSignals)) {
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      items: [],
      missingSources: [],
      message: "请先确认风格画像，或补充关注方向/知识库后再刷新相关信息。"
    });
  }
  const targetDate = normalizeTargetDate(payload.date);
  const trendContext = await collectHotspotTopicContext({ userSignals, targetDate });
  const items = buildRelatedInfoItems(trendContext, userSignals).slice(0, 8);
  return sendJson(res, 200, {
    generatedAt: new Date().toISOString(),
    targetDate,
    items,
    missingSources: trendContext.missingSources,
    sourceCount: {
      topHub: trendContext.topHubItems.length,
      search: trendContext.searchItems.length
    },
    message: items.length ? "已读取公开新闻，优先展示可点击核验的新闻来源。" : "没有读取到可核验的公开新闻，请补充更具体的关键词。"
  });
}

function buildRelatedInfoItems(trendContext, userSignals) {
  const seeds = getStrictUserSeeds(userSignals).map((item) => String(item || "").toLowerCase()).filter(Boolean);
  const rawItems = [...trendContext.searchItems];
  return rawItems
    .filter((item) => item && item.title && item.url)
    .filter((item) => isNewsLikeSearchItem(item))
    .map((item) => {
      const haystack = [item.title, item.summary, item.source, item.query].join(" ").toLowerCase();
      const relevance = seeds.reduce((score, seed) => score + (seed && haystack.includes(seed) ? 3 : 0), 0);
      const score = relevance + getNewsSourceScore(item.url, item.source);
      return { item, score };
    })
    .filter(({ item, score }) => !seeds.length || score > 0 || matchesAnySeed(item, seeds))
    .sort((a, b) => b.score - a.score)
    .map(({ item }, index) => ({
      rank: index + 1,
      title: String(item.title || "").slice(0, 120),
      source: item.source || "公开新闻",
      channel: "news",
      url: item.url,
      publishedAt: item.publishedAt || item.date || "",
      reason: buildRelatedInfoReason(item, userSignals),
      category: "公开新闻",
      trend: item.publishedAt ? `新闻 · ${item.publishedAt}` : "新闻/行业信息"
    }));
}

function getStrictUserSeeds(userSignals) {
  const explicit = uniqueStrings([
    ...userSignals.manualKeywords,
    ...userSignals.focusDomains,
    ...userSignals.focusTopics,
    ...extractSearchWords(userSignals.notes || ""),
    ...extractSearchWords(userSignals.knowledgeNotes || "")
  ]);
  if (explicit.length) return explicit.slice(0, 8);
  return uniqueStrings([
    ...userSignals.domains,
    ...userSignals.topics,
    ...userSignals.keywords
  ]).slice(0, 8);
}

function matchesAnySeed(item, seeds) {
  const haystack = [item.title, item.summary, item.source, item.query].join(" ").toLowerCase();
  return seeds.some((seed) => seed && haystack.includes(seed));
}

function buildRelatedInfoReason(item, userSignals) {
  const topic = getStrictUserSeeds(userSignals)[0] || "关注方向";
  return `与“${topic}”相关的可点击新闻来源，可作为选题依据、背景材料或案例线索。`;
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

async function parseDocxSource(buffer, title) {
  const warnings = [];
  let mammothText = "";
  const mammoth = loadMammoth();
  if (mammoth) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      mammothText = String(result.value || "").trim();
      for (const message of result.messages || []) {
        if (message?.message) warnings.push(message.message);
      }
    } catch (error) {
      warnings.push(`mammoth 解析失败，已尝试 XML 兜底：${error.message}`);
    }
  } else {
    warnings.push("mammoth 未安装，使用 XML 兜底解析。线上部署后会自动安装依赖。");
  }

  let xmlText = "";
  let xmlWarnings = [];
  try {
    const xmlResult = extractDocxStructuredText(buffer);
    xmlText = xmlResult.text;
    xmlWarnings = xmlResult.warnings;
  } catch (error) {
    xmlWarnings.push(`XML 兜底解析失败：${error.message}`);
  }

  const body = chooseBetterText(mammothText, xmlText);
  const mergedWarnings = uniqueStrings([...warnings, ...xmlWarnings]);
  if (!body) {
    return buildFailedSource({
      type: "docx",
      title,
      reason: "没有检测到普通正文，可能是图片稿、扫描稿、复杂文本框或非标准 DOCX。",
      extractionMethod: mammoth ? "mammoth+xml-fallback" : "xml-fallback",
      warnings: mergedWarnings,
      suggestedActions: ["确认 Word 中的文字可以被鼠标选中", "另存为标准 DOCX 后重传", "复制正文粘贴到左侧文本框", "如果是图片稿，请上传截图或手动粘贴正文"]
    });
  }

  return buildParsedSource({
    type: "docx",
    title,
    body,
    sections: inferTextSections(body),
    extractionMethod: mammoth ? "mammoth+xml-fallback" : "xml-fallback",
    warnings: mergedWarnings
  });
}

function loadMammoth() {
  if (mammothModule) return mammothModule;
  try {
    mammothModule = require("mammoth");
    return mammothModule;
  } catch (_error) {
    return null;
  }
}

function chooseBetterText(primary, fallback) {
  const a = normalizeExtractedText(primary);
  const b = normalizeExtractedText(fallback);
  return b.length > a.length * 1.25 ? b : a;
}

function normalizeExtractedText(text) {
  return String(text || "")
    .split(String.fromCharCode(13)).join("\n")
    .replace(new RegExp("[ \t\f\v]+", "g"), " ")
    .replace(new RegExp("\\n\\s+", "g"), "\n")
    .replace(new RegExp("\\n{3,}", "g"), "\n\n")
    .trim();
}

function extractDocxStructuredText(buffer) {
  const entries = unzipEntries(buffer);
  const headerFooterPattern = new RegExp("^word/(header|footer)\\d+\\.xml$");
  const xmlNames = Object.keys(entries).filter((name) => {
    return (
      name === "word/document.xml" ||
      headerFooterPattern.test(name) ||
      ["word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"].includes(name)
    );
  });
  const warnings = [];
  if (Object.keys(entries).some((name) => name.startsWith("word/media/"))) warnings.push("文档包含图片，图片中文字不会被 DOCX 正文解析覆盖。");
  if (entries["word/comments.xml"]) warnings.push("文档包含批注，已尝试读取批注文字。");
  const text = xmlNames
    .map((name) => extractDocxXmlText(entries[name].toString("utf8")))
    .filter(Boolean)
    .join("\n")
    .replace(new RegExp("\\n{3,}", "g"), "\n\n")
    .trim();
  return { text, warnings };
}

function buildParsedSource({ type, title, body, sections = [], tables = [], mediaSignals = [], extractionMethod = "local", warnings = [] }) {
  const text = normalizeExtractedText(body).slice(0, 24000);
  const extractionStatus = text.length >= 500 ? "complete" : "partial";
  const confidence = text.length >= 1200 ? "high" : text.length >= 300 ? "medium" : "low";
  const status = extractionStatus === "complete" ? `已解析 · ${text.length}字` : `部分读取 · ${text.length}字`;
  return {
    type,
    title,
    body: text,
    sections: sections.length ? sections : inferTextSections(text),
    tables,
    mediaSignals,
    extractionMethod,
    extractionStatus,
    confidence,
    warnings: uniqueStrings(warnings).slice(0, 6),
    suggestedActions: extractionStatus === "partial" ? ["可继续读稿，但建议补充原文或更多材料提高准确度"] : [],
    status,
    limited: false
  };
}
function buildFailedSource({ type, title, reason, extractionMethod = "local", warnings = [], suggestedActions = [] }) {
  return {
    type,
    title,
    body: reason,
    sections: [],
    tables: [],
    mediaSignals: [],
    extractionMethod,
    extractionStatus: "failed",
    confidence: "low",
    warnings: uniqueStrings(warnings.length ? warnings : [reason]).slice(0, 6),
    suggestedActions: suggestedActions.length ? suggestedActions : ["粘贴正文", "重新上传标准文件", "上传截图或可复制文字"],
    status: "解析失败，需补充正文",
    limited: true
  };
}

function inferTextSections(text) {
  const lines = String(text || "").split(new RegExp("\\n+")).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  for (const line of lines.slice(0, 80)) {
    const type = classifyContentLine(line);
    if (type) sections.push({ type, text: line.slice(0, 500) });
  }
  return sections.slice(0, 30);
}

function classifyContentLine(line) {
  const text = String(line || "").trim();
  if (!text) return "";
  if (new RegExp("^(标题|题目|主题|选题)[:：]").test(text) || (text.length <= 32 && new RegExp("[：?？！!]?$").test(text))) return "title";
  if (new RegExp("^(开场|开头|引入|hook|口播开场)[:：]", "i").test(text)) return "opening";
  if (new RegExp("^(转场|过渡|承接)[:：]").test(text)) return "transition";
  if (new RegExp("^(结尾|收尾|总结|互动引导|评论区)[:：]").test(text)) return "ending";
  if (new RegExp("^(口播|旁白|对白|画面|镜头|字幕|BGM|音乐)[:：]", "i").test(text)) return "script";
  return "body";
}
function extractDocxText(buffer) {
  const result = extractDocxStructuredText(buffer);
  if (!result.text) throw new Error("DOCX 中没有读取到正文");
  return result.text;
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
      const runs = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((match) => cleanDocxTextRun(match[1]))
        .filter(Boolean);
      return runs.join("");
    })
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function cleanDocxTextRun(value) {
  const decoded = decodeHtml(value);
  const compact = decoded.trim();
  if (!compact) return "";
  if (isEmbeddedWordXml(compact)) return "";
  return decoded;
}

function isEmbeddedWordXml(value) {
  if (!/^<\/?[a-z]+:/i.test(value)) return false;
  const tagCount = (value.match(/<\/?[a-z]+:[^>]+>/gi) || []).length;
  return tagCount >= 2 || /<w:(p|r|sdt|pPr|rPr|tbl|tr|tc)\b/i.test(value);
}

function decodeBufferText(buffer) {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, 4096));
  const charset = detectCharset("", head);
  return new TextDecoder(charset, { fatal: false }).decode(buffer);
}

async function fetchPublicPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLIC_PAGE_TIMEOUT_MS);
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
  const focusedHtml = extractArticleHtml(html) || html;
  const text = decodeHtml(
    focusedHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<img\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
  return {
    title,
    text: [title, description, text].filter(Boolean).join("\n\n").slice(0, 12000),
  };
}

function extractArticleHtml(html) {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch && cleanText(articleMatch[1]).length > 200) return articleMatch[1];
  const peopleBox = sliceHtmlFromClass(html, "box_con", ["<!--text_con end-->", "<div class=\"edit", "<div class='edit", "<div class=\"page", "<div class='page"]);
  if (peopleBox && cleanText(peopleBox).length > 200) return peopleBox;
  const commonContent = sliceHtmlFromClass(html, "article", ["</article>"]) || sliceHtmlFromClass(html, "content", ["<!--", "<footer", "<div class=\"footer", "<div class='footer"]);
  if (commonContent && cleanText(commonContent).length > 200) return commonContent;
  return "";
}

function sliceHtmlFromClass(html, className, endMarkers) {
  const classPattern = new RegExp("<[^>]+class=[\"'][^\"']*\\b" + escapeRegExp(className) + "\\b[^\"']*[\"'][^>]*>", "i");
  const match = classPattern.exec(html);
  if (!match) return "";
  const start = match.index;
  const rest = html.slice(start);
  const end = endMarkers
    .map((marker) => rest.indexOf(marker))
    .filter((index) => index > match[0].length)
    .sort((a, b) => a - b)[0];
  return end ? rest.slice(0, end) : rest.slice(0, 20000);
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
      "请区分文本特征、节点话术和传播线索。若抖音链接尚未被真实爬取，不要编造作品内容。",
      "请专门分析节点话术：开场方式、结尾方式、自我介绍、转场/过渡句、口头禅或固定表达。",
      "暂不分析拍摄、字幕、时长、封面等视频线索。",
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
      "如果用户反馈涉及开场、结尾、自我介绍、转场或口头禅，请更新 speechPatterns。",
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
      "如画像中有 speechPatterns，请在合适位置沿用其开场、过渡、收尾、自我介绍或固定表达。",
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
  const focusProfile = normalizeFocusProfile(payload.focusProfile || {});
  sendSseHeaders(res);
  try {
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的成稿后台。",
        "请基于已确认的文风画像和额外规则写初稿。",
        "如画像中有 speechPatterns，请在合适位置沿用其开场、过渡、收尾、自我介绍或固定表达。",
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

async function generateWorkflowStream(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const task = String(payload.task || "").slice(0, 4000);
  const type = String(payload.type || "内容").slice(0, 100);
  const mode = String(payload.mode || "fast") === "deep" ? "deep" : "fast";
  const focusProfile = normalizeFocusProfile(payload.focusProfile || {});
  sendSseHeaders(res);

  try {
    if (mode === "fast") {
      writeSse(res, "stage", { name: "fast" });
      await callChatCompletionsStream({
        instructions: [
          "你是 Content Simulator 的内容生产后台，服务对象是成熟内容创作者、记者、作者和专业博主。",
          "本次使用快速模式：不要跑冗长评估流程，直接输出一版可修改、可继续打磨的工作底稿。",
          "必须尊重用户已经确认的风格画像、长期关注领域、平台偏好和规则；不要替用户强行追热点。",
          "内容要有清晰观点、具体切口、事实意识和段落推进，避免空泛鸡汤、营销腔、模板化总结。",
          "如果用户任务缺少事实材料，可以提出审慎表述，但不要编造数据、人物、来源或新闻细节。",
          "直接输出正文，不要解释过程，不要输出 JSON，不要输出 Markdown 代码块。"
        ].join("\n"),
        input: JSON.stringify({
          task: "生成快速工作底稿",
          contentType: type,
          userTask: task,
          profile,
          focusProfile,
          rules
        }),
        onThinking: (text) => writeSse(res, "thinking", { text }),
        onContent: (text) => writeSse(res, "finalContent", { text })
      });
      writeSse(res, "done", { ok: true, mode });
      return;
    }

    const trendContextPromise = collectTrendContext(task).catch(() => ({ hotItems: [], note: "热点读取失败，按用户任务生成。" }));
    let initialDraft = "";
    let evaluation = "";

    writeSse(res, "stage", { name: "draft" });
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的内容初稿后台。",
        "先不要模仿用户文风，优先生成有信息量、有角度、有表达创造力的内容初稿。",
        "请结合 focusProfile 中的关注领域、长期话题、平台偏好和用户补充说明。",
        "深度模式下热点资料会在后续评估阶段补入；本阶段不要等待外部热点抓取，也不要编造事实。",
        "直接输出完整初稿正文，不要输出 JSON，不要输出 Markdown 代码块。"
      ].join("\n"),
      input: JSON.stringify({
        task: "生成内容初稿",
        contentType: type,
        userTask: task,
        focusProfile,
        trendContext: { note: "初稿阶段不等待外部热点抓取，优先出稿。" }
      }),
      onThinking: (text) => writeSse(res, "thinking", { text }),
      onContent: (text) => {
        initialDraft += text;
        writeSse(res, "draftContent", { text });
      }
    });

    const trendContext = await trendContextPromise;

    writeSse(res, "stage", { name: "evaluation" });
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的内容评估后台。",
        "请对初稿做五维评分：新闻性/时效性、网络传播价值、情绪感染力、故事真实感/贴近性、信息可靠性。",
        "每项给 0-100 分，并用一句短理由说明。",
        "如果公开热点上下文不足，要明确指出缺口；不要为了显得有依据而虚构来源。",
        "输出要简洁，不要输出 JSON，不要输出 Markdown 表格。"
      ].join("\n"),
      input: JSON.stringify({
        task: "五维评分",
        userTask: task,
        draft: initialDraft,
        trendContext
      }),
      onThinking: (text) => writeSse(res, "thinking", { text }),
      onContent: (text) => {
        evaluation += text;
        writeSse(res, "evaluationContent", { text });
      }
    });

    writeSse(res, "stage", { name: "final" });
    await callChatCompletionsStream({
      instructions: [
        "你是 Content Simulator 的文风优化后台。",
        "请基于初稿和五维评分进行二次优化，同时贴近用户已确认的文风画像。",
        "请继续贴合 focusProfile 中的关注领域、长期话题、平台偏好和用户补充说明。",
        "必须参考 profile 中的常用词、文本风格、节奏话术、开头禁忌、额外规则。",
        "保留初稿中有价值的信息和角度，提升网感、可读性和传播性。",
        "不要解释优化过程，直接输出完整可交付稿件正文，不要输出 JSON，不要输出 Markdown 代码块。"
      ].join("\n"),
      input: JSON.stringify({
        task: "结合文风优化",
        contentType: type,
        userTask: task,
        initialDraft,
        evaluation,
        profile,
        focusProfile,
        rules
      }),
      onThinking: (text) => writeSse(res, "thinking", { text }),
      onContent: (text) => writeSse(res, "finalContent", { text })
    });

    writeSse(res, "done", { ok: true, mode });
  } catch (error) {
    writeSse(res, "error", { error: error.message || "工作流生成失败" });
  } finally {
    res.end();
  }
}

async function generateHotspotTopics(_req, res, payload) {
  const profile = normalizeProfile(payload.profile || {}, payload.rules || []);
  const focusProfile = normalizeFocusProfile(payload.focusProfile || {});
  const rules = normalizeRules(payload.rules || profile.rules || []);
  const keywords = String(payload.keywords || payload.query || "").slice(0, 1000).trim();
  const userSignals = buildHotspotUserSignals(profile, focusProfile, rules, keywords);
  if (!hasHotspotUserSignals(userSignals)) {
    return sendJson(res, 422, {
      error: "请先确认风格画像，或输入关注话题/关键词后再生成热点选题。"
    });
  }

  const targetDate = normalizeTargetDate(payload.date);
  const outputLimit = clamp(Math.round(Number(payload.limit || 4)), 4, 6);
  const trendContext = await collectHotspotTopicContext({ userSignals, targetDate });

  if (!trendContext.topHubItems.length && !trendContext.searchItems.length) {
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      targetDate,
      topics: [],
      bestTopicReason: "",
      missingSources: trendContext.missingSources,
      message: "没有读取到可核验的热点来源，暂不生成选题。请补充关键词，或稍后重试。"
    });
  }

  const text = await callOpenAI({
    instructions: [
      "你是 Content Simulator 的热点选题后台，服务对象是记者、内容创作者、博主和运营人员。",
      "只能基于输入里的 TopHub 热榜、公开搜索结果、日期节点和用户画像做筛选与改写，不得编造不存在的热点事件。",
      "TopHub 和公开搜索是平级来源；如果某类来源缺失，保留 missingSources，不要用猜测补齐。",
      "先过滤高风险话题，再做选题推荐；避免消耗他人苦难、暴力血腥、色情赌博、歧视、宗教冲突、纯政治或战争冲突话题。",
      "评分权重：新闻性/热点锚点25，用户适合度25，网络传播价值15，情绪与社会气候15，差异化切口10，信息可靠性5，风险可控性5。不要只追热点，要判断该用户是否真的能讲好。",
      "允许安全的间接借势：热点不必与用户领域字面直接相关，但必须在 sourceSummary/newsValue/fitReason 中讲清楚桥接逻辑，例如同一种社会情绪、同一类用户需求、同一类风险结构、同一类生活场景或同一类行业转折。",
      "禁止硬蹭：如果只能靠关键词强连，或者无法说清热点精神与用户需求的关系，就降分或舍弃。安全边界优先，避免消费灾难、隐私、极端冲突和敏感政治事件。",
      "输出 Top4，除非用户显式要求更多；每个选题要说明为什么值得做、适合谁做、热点如何转译、从哪里切入。",
      "只输出合法 JSON，不要 Markdown，不要解释过程。"
    ].join("\n"),
    input: JSON.stringify({
      task: "生成热点选题 Top4",
      targetDate,
      outputLimit,
      userSignals,
      trendContext,
      expectedShape: {
        generatedAt: "ISO时间",
        missingSources: ["缺失来源说明"],
        bestTopicReason: "为什么排名第一的选题最好",
        topics: [
          {
            rank: 1,
            title: "选题标题",
            sourceSummary: "引用到的真实热点/新闻来源摘要，并说明是直接相关还是间接借势",
            referenceUrls: ["可核验链接"],
            newsValue: "新闻性/热点锚点判断，说明热点精神如何转译到该用户需求",
            fitReason: "为什么适合该用户，必须说明能力/受众/表达方式的匹配",
            suggestedAngle: "建议切口",
            riskNote: "风险提示或表达边界",
            scores: {
              newsworthiness: 0,
              userFit: 0,
              spreadValue: 0,
              socialMood: 0,
              differentiation: 0,
              reliability: 0,
              riskControl: 0,
              total: 0
            }
          }
        ]
      }
    })
  });

  const normalized = normalizeHotspotResponse(parseJson(text), trendContext, targetDate, outputLimit);
  if (!normalized.topics.length) {
    return sendJson(res, 200, {
      ...normalized,
      message: "模型没有基于真实来源生成可用选题，请换一组关键词重试。"
    });
  }
  return sendJson(res, 200, normalized);
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
      "保留或按用户要求调整 speechPatterns 中的开场、过渡、收尾和口头禅。",
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
        "保留或按用户要求调整 speechPatterns 中的开场、过渡、收尾和口头禅。",
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

async function collectTrendContext(task) {
  const hotItems = await fetchTopHubItems().catch(() => []);
  const keywords = extractSearchWords(task);
  const matched = hotItems.filter((item) => keywords.some((word) => item.includes(word)));
  return {
    note: hotItems.length ? "已读取公开热榜摘要，作为网感和时效参考。" : "未读取到公开热榜，按用户任务生成。",
    keywords,
    hotItems: (matched.length ? matched : hotItems).slice(0, 12)
  };
}

async function fetchTopHubItems() {
  const entries = await fetchTopHubEntries();
  return entries.map((item) => `${item.source}：${item.title}`).slice(0, 40);
}

async function collectHotspotTopicContext({ userSignals, targetDate }) {
  const missingSources = [];
  const [topHubResult, searchResult] = await Promise.allSettled([
    fetchTopHubEntries(),
    fetchPublicSearchItems(buildHotspotSearchQueries(userSignals, targetDate))
  ]);

  let topHubItems = topHubResult.status === "fulfilled" ? topHubResult.value : [];
  let searchItems = searchResult.status === "fulfilled" ? searchResult.value : [];
  topHubItems = topHubItems.filter((item) => !isSensitiveHotTopic(item.title)).slice(0, 48);
  searchItems = searchItems.filter((item) => !isSensitiveHotTopic(item.title)).slice(0, 40);

  if (!topHubItems.length) missingSources.push("TopHub 热榜未读取到可用条目");
  if (!searchItems.length) missingSources.push("近一周公开新闻未读取到可用条目");

  return {
    sourceRule: "TopHub 用于判断平台热度和社会情绪；公开新闻用于事实核验和新闻依据；搜索窗口放宽到近一周。日期节点只用于判断内容时机，不可当作真实热点事件。",
    topHubItems,
    searchItems,
    calendarContext: buildCalendarContext(targetDate),
    missingSources
  };
}

async function fetchTopHubEntries() {
  const now = Date.now();
  if (topHubCache.entries.length && topHubCache.expiresAt > now) {
    return topHubCache.entries;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOPHUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://tophub.today/", {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const html = await response.text();
    const candidates = extractTopHubCandidates(html);
    const entries = dedupeHotspotItems(candidates).slice(0, 60);
    if (entries.length) {
      topHubCache.entries = entries;
      topHubCache.expiresAt = Date.now() + TOPHUB_CACHE_TTL_MS;
    }
    return entries;
  } catch (error) {
    if (topHubCache.entries.length) return topHubCache.entries;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractTopHubCandidates(html) {
  const items = [];
  const anchorMatches = [...String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchorMatches) {
    const title = cleanText(match[2]);
    if (!isUsableHotspotTitle(title)) continue;
    const href = normalizeHref(match[1], "https://tophub.today/");
    items.push({
      title,
      source: "TopHub",
      url: href || "https://tophub.today/",
      channel: "tophub"
    });
  }

  if (items.length >= 12) return items;

  const text = cleanText(html);
  text
      .split(/(?=微博|知乎|百度|抖音|微信|今日头条|哔哩哔哩|小红书)|\s{2,}/)
      .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(isUsableHotspotTitle)
    .forEach((title) => items.push({
      title,
      source: "TopHub",
      url: "https://tophub.today/",
      channel: "tophub"
    }));

  return items;
}

async function fetchPublicSearchItems(queries) {
  const engines = [
    {
      name: "Bing News",
      buildUrl: (query) => `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&setlang=zh-CN&cc=CN&qft=interval%3d%227%22&FORM=HDRSC6`
    },
    {
      name: "百度新闻",
      buildUrl: (query) => `https://www.baidu.com/s?tn=news&rtt=1&bsst=1&cl=2&rn=20&wd=${encodeURIComponent(query)}`
    }
  ];
  const jobs = queries.slice(0, 5).flatMap((query) => engines.map((engine) => ({ query, engine })));
  const settled = await Promise.allSettled(jobs.map((job) => fetchSearchPage(job.query, job.engine)));
  const items = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  return dedupeHotspotItems(items).filter(isNewsLikeSearchItem).slice(0, 40);
}

async function fetchSearchPage(query, engine) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(engine.buildUrl(query), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return extractSearchCandidates(html, query, engine.name);
  } finally {
    clearTimeout(timer);
  }
}

function extractSearchCandidates(html, query, engineName) {
  const items = [];
  const cleanHtml = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const anchorPattern = new RegExp(String.raw`<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)<\/a>`, "gi");
  const anchorMatches = [...cleanHtml.matchAll(anchorPattern)];
  for (const match of anchorMatches) {
    const title = cleanText(match[2]);
    if (!isUsableHotspotTitle(title)) continue;
    const base = engineName.includes("百度") ? "https://www.baidu.com/" : "https://www.bing.com/";
    const url = normalizeHref(match[1], base);
    if (!isLikelyNewsUrl(url, title)) continue;
    items.push({
      title,
      source: `公开新闻-${engineName}`,
      query,
      url,
      channel: "news"
    });
  }
  return items.slice(0, 16);
}

function buildHotspotSearchQueries(userSignals, targetDate) {
  const explicitSeeds = uniqueStrings([
    ...userSignals.manualKeywords,
    ...userSignals.focusDomains,
    ...userSignals.focusTopics,
    ...extractSearchWords(userSignals.notes || ""),
    ...extractSearchWords(userSignals.knowledgeNotes || "")
  ]);
  const fallbackSeeds = uniqueStrings([
    ...userSignals.keywords,
    ...userSignals.domains,
    ...userSignals.topics
  ]);
  const uniqueSeeds = (explicitSeeds.length ? explicitSeeds : fallbackSeeds).slice(0, 5);
  const dateLabel = targetDate.label.replace(/年|月/g, " ").replace("日", "").trim();
  if (!uniqueSeeds.length) return [`${dateLabel} 近一周 新闻 热点`];
  return uniqueSeeds.map((seed) => `${seed} 近一周 新闻 热点 行业`);
}

function buildHotspotUserSignals(profile, focusProfile, rules, keywords) {
  const manualKeywords = extractSearchWords(keywords);
  const focusDomains = uniqueStrings(focusProfile.domains || []);
  const focusTopics = uniqueStrings(focusProfile.topics || []);
  const explicitSeeds = uniqueStrings([
    ...manualKeywords,
    ...focusDomains,
    ...focusTopics,
    ...extractSearchWords(focusProfile.notes || ""),
    ...extractSearchWords(focusProfile.knowledgeNotes || "")
  ]);
  const domainNames = (profile.domains || []).map((item) => item.name).filter(Boolean);
  const profileKeywords = (profile.keywords || []).map((item) => item.word).filter(Boolean);
  const useExplicitOnly = explicitSeeds.length > 0;
  return {
    manualKeywords,
    focusDomains,
    focusTopics,
    domains: (useExplicitOnly ? focusDomains : uniqueStrings([...focusDomains, ...domainNames])).slice(0, 8),
    topics: (useExplicitOnly ? focusTopics : uniqueStrings([...focusTopics, ...profileKeywords])).slice(0, 12),
    keywords: (useExplicitOnly ? explicitSeeds : uniqueStrings([...manualKeywords, ...profileKeywords, ...focusTopics])).slice(0, 12),
    platforms: focusProfile.platforms || [],
    notes: focusProfile.notes || "",
    knowledgeNotes: focusProfile.knowledgeNotes || "",
    rules: rules.slice(0, 12),
    styleSummary: {
      confidence: profile.confidence || "",
      contentFeatures: (profile.contentFeatures || []).filter((item) => !/待继续学习|待补充/.test(item)).slice(0, 6),
      textFeatures: (profile.textFeatures || []).filter((item) => !/待继续学习|待补充/.test(item)).slice(0, 6),
      speechPatterns: (profile.speechPatterns || []).filter((item) => !/待继续学习|待补充/.test(item)).slice(0, 6)
    }
  };
}

function hasHotspotUserSignals(userSignals) {
  return Boolean(
    userSignals.manualKeywords.length ||
    userSignals.focusDomains.length ||
    userSignals.focusTopics.length ||
    userSignals.domains.length ||
    userSignals.topics.length ||
    String(userSignals.notes || "").trim() ||
    String(userSignals.knowledgeNotes || "").trim()
  );
}

function normalizeHotspotResponse(parsed, trendContext, targetDate, outputLimit) {
  const source = Array.isArray(parsed) ? { topics: parsed } : (parsed || {});
  const topics = (Array.isArray(source.topics) ? source.topics : [])
    .map((topic, index) => normalizeHotspotTopic(topic, index))
    .filter((topic) => topic.title && !isSensitiveHotTopic(topic.title))
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, outputLimit)
    .map((topic, index) => ({ ...topic, rank: index + 1 }));
  return {
    generatedAt: new Date().toISOString(),
    targetDate,
    topics,
    bestTopicReason: String(source.bestTopicReason || topics[0]?.fitReason || "").slice(0, 500),
    missingSources: Array.from(new Set([...(trendContext.missingSources || []), ...normalizeList(source.missingSources, [])])),
    sourceCount: {
      topHub: trendContext.topHubItems.length,
      search: trendContext.searchItems.length
    }
  };
}

function normalizeHotspotTopic(topic, index) {
  const scores = normalizeHotspotScores(topic?.scores || {});
  return {
    rank: clamp(Math.round(Number(topic?.rank || index + 1)), 1, 99),
    title: String(topic?.title || "").slice(0, 80).trim(),
    sourceSummary: String(topic?.sourceSummary || "").slice(0, 260),
    referenceUrls: normalizeUrls(topic?.referenceUrls || topic?.urls || []),
    newsValue: String(topic?.newsValue || "").slice(0, 180),
    fitReason: String(topic?.fitReason || topic?.reason || "").slice(0, 220),
    suggestedAngle: String(topic?.suggestedAngle || topic?.angle || "").slice(0, 220),
    riskNote: String(topic?.riskNote || "注意核验事实，避免夸大。").slice(0, 160),
    scores
  };
}

function normalizeHotspotScores(scores) {
  const normalized = {
    newsworthiness: normalizeScore(scores.newsworthiness),
    userFit: normalizeScore(scores.userFit),
    spreadValue: normalizeScore(scores.spreadValue),
    socialMood: normalizeScore(scores.socialMood),
    differentiation: normalizeScore(scores.differentiation),
    reliability: normalizeScore(scores.reliability),
    riskControl: normalizeScore(scores.riskControl)
  };
  const total = Number(scores.total);
  normalized.total = Number.isFinite(total)
    ? clamp(Math.round(total), 0, 100)
    : Math.round(
      normalized.newsworthiness * 0.25 +
      normalized.userFit * 0.25 +
      normalized.spreadValue * 0.15 +
      normalized.socialMood * 0.15 +
      normalized.differentiation * 0.1 +
      normalized.reliability * 0.05 +
      normalized.riskControl * 0.05
    );
  return normalized;
}

function normalizeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number), 0, 100) : 0;
}

function normalizeUrls(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  return Array.from(new Set(list.map((url) => String(url || "").trim()).filter((url) => /^https?:\/\//i.test(url)))).slice(0, 4);
}

function dedupeHotspotItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const title = String(item.title || "").replace(/\s+/g, " ").trim();
    const key = title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...item, title });
  }
  return output;
}

function isUsableHotspotTitle(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (text.length < 6 || text.length > 90) return false;
  if (/^(首页|登录|注册|更多|展开|收起|广告|反馈|关于|客户端|今日热榜|全网热榜|排行榜)$/i.test(text)) return false;
  if (/ICP备案|Copyright|加载中|请输入|搜索|收藏本站/.test(text)) return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

function isSensitiveHotTopic(title) {
  return /色情|赌博|毒品|血腥|恐怖袭击|枪击|人肉搜索|偷拍视频|尾随|分裂|颠覆|暴力革命|宗教冲突|种族歧视|性别歧视|黄赌毒/i.test(String(title || ""));
}

function uniqueStrings(items) {
  return Array.from(new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function isNewsLikeSearchItem(item) {
  if (!item || !item.url || !item.title) return false;
  return isLikelyNewsUrl(item.url, item.title) && !isNonNewsTitle(item.title);
}

function isLikelyNewsUrl(url, title = "") {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch (_error) {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (isNonNewsHost(host) || isSearchResultUrl(host, path)) return false;
  if (isTrustedNewsHost(host)) return true;
  if (/(news|xinwen|article|articles|content|n\d+|c\d+|a\d+|20\d{2}[/-]?\d{1,2}[/-]?\d{1,2})/i.test(path)) return true;
  return /新闻|报道|发布|通报|公告|监管|调查|回应|启动|召开|出台|政策|处罚|风险|行业|记者|中新|新华|央视|人民网|财联社|证券|经济/.test(String(title || ""));
}

function isTrustedNewsHost(host) {
  return /(people\.com\.cn|xinhuanet\.com|news\.cn|chinanews\.com|cctv\.com|china\.com\.cn|gov\.cn|thepaper\.cn|yicai\.com|caixin\.com|cls\.cn|stcn\.com|cnstock\.com|21jingji\.com|eeo\.com\.cn|sina\.com\.cn|163\.com|qq\.com|sohu\.com|ifeng\.com|toutiao\.com|guancha\.cn|jiemian\.com|36kr\.com|tmtpost\.com|donews\.com)/i.test(host);
}

function isNonNewsHost(host) {
  return /(baike\.baidu\.com|wikipedia\.org|zhihu\.com|douban\.com|bilibili\.com|csdn\.net|jianshu\.com|docin\.com|wenku\.baidu\.com|speedtest|ceping|test|github\.com|gitee\.com|aliyun\.com|cloudflare\.com|microsoft\.com|apple\.com)/i.test(host);
}

function isSearchResultUrl(host, path) {
  if (/baidu\.com/i.test(host)) return /\/s\?/i.test(path);
  return /(bing\.com|google\.com|sogou\.com|so\.com)/i.test(host) && /(\/search|\/link\?|\/ck\/)/i.test(path);
}

function isNonNewsTitle(title) {
  return /(百科|维基百科|知识点|全面总结|测速|网速测试|官方网站|登录|注册|下载|招聘|词条|是什么|怎么用|教程|文档|问答|知乎|CSDN|GitHub|豆瓣)/i.test(String(title || ""));
}

function getNewsSourceScore(url, source = "") {
  try {
    const host = new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase();
    return (isTrustedNewsHost(host) ? 3 : 1) + (String(source || "").includes("Bing") ? 1 : 0);
  } catch (_error) {
    return 0;
  }
}
function normalizeHref(href, baseUrl) {
  try {
    return new URL(String(href || ""), baseUrl).href;
  } catch (_error) {
    return "";
  }
}

function normalizeTargetDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return {
      iso: `${year}-${pad2(month)}-${pad2(day)}`,
      label: `${year}年${month}月${day}日`,
      year,
      month,
      day
    };
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    iso: `${year}-${pad2(month)}-${pad2(day)}`,
    label: `${year}年${month}月${day}日`,
    year,
    month,
    day
  };
}

function buildCalendarContext(targetDate) {
  const month = targetDate.month;
  const day = targetDate.day;
  const monthRhythms = {
    1: ["新年规划", "春节前消费", "返乡与年货"],
    2: ["春节团圆", "开工复苏", "情人节消费"],
    3: ["春季踏青", "女性消费", "消费者权益"],
    4: ["清明踏青", "地球日", "春季换新"],
    5: ["劳动节出行", "母亲节", "夏季前消费"],
    6: ["高考毕业季", "618大促", "防暑旅游"],
    7: ["暑假", "小暑/大暑", "防暑降温", "亲子旅游"],
    8: ["暑期尾声", "返校准备", "夏秋换季"],
    9: ["开学季", "中秋前后", "国庆出行准备"],
    10: ["国庆出行", "秋季丰收", "双11预热"],
    11: ["双11", "入冬", "年末计划"],
    12: ["年终总结", "冬至养生", "节日消费"]
  };
  const solarTerms = {
    1: ["小寒", "大寒"],
    2: ["立春", "雨水"],
    3: ["惊蛰", "春分"],
    4: ["清明", "谷雨"],
    5: ["立夏", "小满"],
    6: ["芒种", "夏至"],
    7: ["小暑", "大暑"],
    8: ["立秋", "处暑"],
    9: ["白露", "秋分"],
    10: ["寒露", "霜降"],
    11: ["立冬", "小雪"],
    12: ["大雪", "冬至"]
  };
  const fixedDays = {
    "3-8": "国际妇女节",
    "3-15": "消费者权益日",
    "4-22": "世界地球日",
    "5-1": "劳动节",
    "5-17": "世界电信和信息社会日",
    "6-5": "世界环境日",
    "6-8": "世界海洋日",
    "7-8": "全国保险公众宣传日",
    "7-11": "世界人口日",
    "8-12": "国际青年日",
    "9-21": "国际和平日",
    "10-14": "世界标准日",
    "11-14": "世界糖尿病日",
    "12-4": "国家宪法日",
    "12-5": "国际志愿者日"
  };
  const climate = {
    1: "寒冷、返乡、年初规划",
    2: "春节节律、开工转换",
    3: "春季复苏、户外活动增加",
    4: "踏青、换季、环保议题更自然",
    5: "出行、劳动、夏季消费启动",
    6: "毕业季、考试季、暑热开始",
    7: "高温、防暑、暑期出行和亲子场景",
    8: "暑期尾声、返校、极端天气需核验",
    9: "开学、团圆、秋季消费",
    10: "长假、出行、秋季生活方式",
    11: "消费大促、入冬、年末节奏",
    12: "年终复盘、冬季养生、节日消费"
  };
  const todayNode = fixedDays[`${month}-${day}`];
  return {
    date: targetDate.label,
    rhythms: monthRhythms[month] || [],
    solarTerms: solarTerms[month] || [],
    fixedDay: todayNode || "",
    climate: climate[month] || "",
    memeRule: "热梗、热词必须从 TopHub 或公开搜索结果中提取；没有来源时不要生成具体热梗。"
  };
}

function extractSearchWords(text) {
  const words = String(text || "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12);
  return Array.from(new Set(words)).slice(0, 8);
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
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
  const thinking = String(MODEL_THINKING || "disabled").toLowerCase();
  if (thinking === "off") return {};
  if (["disabled", "disable", "false", "0", "none"].includes(thinking)) {
    return { thinking: { type: "disabled" } };
  }
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
    const extractionStatus = String(source.extractionStatus || "");
    const statusText = String(source.status || "");
    const failed = extractionStatus === "failed" || /解析失败|读取受限|需补充|待后端/.test(statusText);
    const body = failed ? "" : String(source.body || "").slice(0, Math.max(0, 24000 - total));
    total += body.length;
    return {
      type: source.type || "text",
      title: String(source.title || "未命名材料").slice(0, 160),
      status: source.status || "",
      extractionStatus: extractionStatus || (failed ? "failed" : body ? "complete" : "limited"),
      confidence: source.confidence || "medium",
      warnings: normalizeList(source.warnings, []).slice(0, 6),
      sections: Array.isArray(source.sections) ? source.sections.slice(0, 30) : [],
      url: source.url || "",
      body,
      limited: failed || !body
    };
  });
}

function hasReadableSources(sources) {
  return sources.some((source) => source.body && !source.limited);
}

function normalizeFocusProfile(focusProfile) {
  return {
    domains: normalizeList(focusProfile.domains, []).slice(0, 6),
    topics: normalizeList(focusProfile.topics, []).slice(0, 10),
    platforms: normalizeList(focusProfile.platforms, []).slice(0, 6),
    notes: String(focusProfile.notes || "").slice(0, 1000)
  };
}

function normalizeProfile(profile, rules = []) {
  const normalized = {
    confidence: ["高", "中", "待补充"].includes(profile.confidence) ? profile.confidence : "中",
    tones: {},
    domains: normalizeDomains(profile.domains),
    keywords: normalizeKeywords(profile.keywords),
    contentFeatures: normalizeList(profile.contentFeatures, ["主题重心待继续学习"]),
    textFeatures: normalizeList(profile.textFeatures, ["文本节奏待继续学习"]),
    speechPatterns: normalizeList(profile.speechPatterns, ["开场、结尾、转场和口头禅待继续学习"]),
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
  const items = Array.isArray(domains) ? domains : [];
  return items.slice(0, 5).map((item, index) => ({
    name: String(item.name || "待补充").slice(0, 20),
    percent: clamp(Math.round(Number(item.percent || item.value || 10)), 1, 100)
  })).filter((item) => item.name && item.name !== "待补充");
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
    speechPatterns: ["开场方式", "结尾方式", "自我介绍", "转场/过渡句", "口头禅或固定表达"],
    trafficFeatures: ["传播线索"],
    rules: ["额外规则"]
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseInviteCodes(value) {
  return new Set(
    String(value || "")
      .split(/[,;\n]/)
      .map(normalizeInviteCode)
      .filter(Boolean)
  );
}

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function createSession(inviteCode) {
  const token = crypto.randomBytes(24).toString("base64url");
  sessions.set(token, {
    token,
    inviteCode,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
  return token;
}

function getAuthSession(req) {
  if (!INVITE_REQUIRED) return { inviteCode: "open" };
  const token = getAuthToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function getAuthToken(req) {
  const authorization = req.headers.authorization || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieToken = parseCookies(req.headers.cookie || "").cs_session;
  return bearer || cookieToken || "";
}

function parseCookies(header) {
  const cookies = {};
  String(header || "").split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(rest.join("="));
  });
  return cookies;
}

function buildSessionCookie(req, token) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `cs_session=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly${secure}`;
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || /^https:/i.test(req.headers.origin || "");
}
function handleCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin && (ALLOWED_ORIGIN === "*" || ALLOWED_ORIGIN === origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
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
    const chunks = [];
    let totalLength = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      totalLength += chunk.length;
      if (totalLength > BODY_LIMIT) {
        rejected = true;
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const body = chunks.length ? Buffer.concat(chunks, totalLength).toString("utf8") : "";
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
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
