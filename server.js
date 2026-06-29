const fs = require("fs");
const http = require("http");
const path = require("path");

loadEnv();

const PORT = Number(process.env.PORT || 10006);
const MODEL_API_KEY = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL_NAME = process.env.MODEL_NAME || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-v4-flash";
const MODEL_BASE_URL = trimTrailingSlash(
  process.env.MODEL_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
);
const MODEL_API_STYLE = process.env.MODEL_API_STYLE || process.env.OPENAI_API_STYLE || "chat";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const ROOT = __dirname;
const BODY_LIMIT = 4 * 1024 * 1024;
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
  if (!MODEL_API_KEY) {
    return sendJson(res, 503, { error: "MODEL_API_KEY or DEEPSEEK_API_KEY is not configured" });
  }

  const payload = await readJsonBody(req);
  if (pathname === "/api/analyze") return analyze(req, res, payload);
  if (pathname === "/api/refine-profile") return refineProfile(req, res, payload);
  if (pathname === "/api/generate") return generateDraft(req, res, payload);
  if (pathname === "/api/revise") return reviseDraft(req, res, payload);
  return sendJson(res, 404, { error: "API not found" });
}

async function analyze(_req, res, payload) {
  const sources = normalizeSources(payload.sources || []);
  const rules = normalizeRules(payload.rules || []);
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
    const body = String(source.body || "").slice(0, Math.max(0, 24000 - total));
    total += body.length;
    return {
      type: source.type || "text",
      title: String(source.title || "未命名材料").slice(0, 160),
      status: source.status || "",
      url: source.url || "",
      body
    };
  });
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
