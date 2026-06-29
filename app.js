const STORAGE_KEY = "content-simulator-state-v1";
const apiBaseFromUrl = new URLSearchParams(window.location.search).get("api");
if (apiBaseFromUrl) {
  localStorage.setItem("content-simulator-api-base", apiBaseFromUrl);
}
const API_BASE = (window.CONTENT_SIMULATOR_API_BASE || localStorage.getItem("content-simulator-api-base") || "").replace(/\/$/, "");

const state = {
  accepted: false,
  currentStep: "collect",
  sources: [],
  profile: null,
  rules: [],
  draft: "",
  thinking: "",
  profileChat: [],
  deliverChat: []
};

const domainBanks = {
  "内容创作": ["内容", "创作", "写作", "文案", "文章", "选题", "账号", "视频", "口播", "表达"],
  "品牌传播": ["品牌", "传播", "公关", "媒体", "声量", "舆论", "发布", "项目", "活动", "故事"],
  "科技产品": ["AI", "人工智能", "模型", "产品", "技术", "数据", "工具", "效率", "平台", "系统"],
  "职场经验": ["职场", "团队", "管理", "经验", "方法", "成长", "工作", "复盘", "沟通", "判断"],
  "生活观察": ["生活", "情绪", "关系", "日常", "选择", "感受", "朋友", "家庭", "城市", "时间"]
};

const toneAxes = ["理性", "亲近", "锋利", "克制", "故事感", "行动感"];
const chartColors = ["#356b54", "#415f82", "#a8674b", "#a58342", "#6f746f"];

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadState();
  bindEvents();
  renderAll();
});

function cacheElements() {
  [
    "consentModal",
    "acceptConsent",
    "clearDataBtn",
    "apiStatus",
    "textInput",
    "addTextBtn",
    "fileInput",
    "dropzone",
    "urlInput",
    "addUrlBtn",
    "sourceList",
    "sourceCount",
    "analyzeBtn",
    "confidenceLabel",
    "toneRadar",
    "domainDonut",
    "domainLegend",
    "keywordChips",
    "contentFeatures",
    "textFeatures",
    "videoFeatures",
    "trafficFeatures",
    "rulesInput",
    "saveRulesBtn",
    "ruleTags",
    "profileChatLog",
    "profileChatInput",
    "profileChatBtn",
    "confirmProfileBtn",
    "profileSummary",
    "taskInput",
    "generateBtn",
    "draftStatus",
    "draftOutput",
    "thinkingWrap",
    "thinkingOutput",
    "copyBtn",
    "downloadTxtBtn",
    "downloadMdBtn",
    "deliverChatLog",
    "deliverChatInput",
    "deliverChatBtn"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.acceptConsent.addEventListener("click", () => {
    state.accepted = true;
    saveState();
    renderConsent();
  });

  els.clearDataBtn.addEventListener("click", () => {
    if (!window.confirm("确认清空本地数据？")) return;
    localStorage.removeItem(STORAGE_KEY);
    Object.assign(state, {
      accepted: true,
      currentStep: "collect",
      sources: [],
      profile: null,
      rules: [],
      draft: "",
      thinking: "",
      profileChat: [],
      deliverChat: []
    });
    renderAll();
  });

  document.querySelectorAll(".step").forEach((button) => {
    button.addEventListener("click", () => goStep(button.dataset.step));
  });

  els.addTextBtn.addEventListener("click", addTextSource);
  els.fileInput.addEventListener("change", handleFiles);
  bindDropzone();
  els.addUrlBtn.addEventListener("click", () => addUrlSource());
  els.analyzeBtn.addEventListener("click", () => analyzeAndGo());
  els.saveRulesBtn.addEventListener("click", saveRulesFromInput);
  els.profileChatBtn.addEventListener("click", () => sendProfileMessage());
  els.profileChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendProfileMessage();
  });
  els.confirmProfileBtn.addEventListener("click", async () => {
    if (!state.profile) await analyzeAndGo(false);
    goStep("deliver");
  });
  els.generateBtn.addEventListener("click", () => generateDraft());
  els.deliverChatBtn.addEventListener("click", () => sendDeliverMessage());
  els.deliverChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendDeliverMessage();
  });
  els.copyBtn.addEventListener("click", copyDraft);
  els.downloadTxtBtn.addEventListener("click", () => downloadDraft("txt"));
  els.downloadMdBtn.addEventListener("click", () => downloadDraft("md"));
  checkApiHealth();
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    Object.assign(state, saved);
  } catch (error) {
    console.warn("Failed to restore state", error);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderAll() {
  renderConsent();
  renderStep();
  renderSources();
  renderProfile();
  renderChats();
  renderDraft();
}

function renderConsent() {
  els.consentModal.classList.toggle("hidden", Boolean(state.accepted));
}

function goStep(step) {
  state.currentStep = step;
  saveState();
  renderStep();
}

function renderStep() {
  document.querySelectorAll(".step").forEach((button) => {
    button.classList.toggle("active", button.dataset.step === state.currentStep);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.getElementById(`${state.currentStep}View`).classList.add("active");
}

function addTextSource() {
  const text = els.textInput.value.trim();
  if (!text) return;
  state.sources.push({
    id: makeId(),
    type: "text",
    title: `粘贴原稿 ${state.sources.length + 1}`,
    body: text,
    status: "已读取"
  });
  els.textInput.value = "";
  saveState();
  renderSources();
}

function bindDropzone() {
  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragging");
    });
  });
  els.dropzone.addEventListener("drop", (event) => {
    addFiles(Array.from(event.dataTransfer.files || []));
  });
}

async function handleFiles(event) {
  await addFiles(Array.from(event.target.files || []));
  event.target.value = "";
}

async function addFiles(files) {
  for (const file of files) {
    const extension = file.name.split(".").pop().toLowerCase();
    const readable = ["txt", "md", "html", "htm"].includes(extension);
    const source = {
      id: makeId(),
      type: extension || "file",
      title: file.name,
      body: "",
      status: readable ? "已读取" : "已记录，待后端解析",
      size: file.size
    };
    if (readable) {
      source.body = await file.text();
    }
    state.sources.push(source);
  }
  saveState();
  renderSources();
}

async function addUrlSource() {
  const url = els.urlInput.value.trim();
  if (!url) return;
  await withBusy(els.addUrlBtn, "正在读取", async () => {
    const isDouyin = /douyin|iesdouyin|v\.douyin/i.test(url);
    let source;
    try {
      const result = await postApi("/api/resolve-url", { url });
      source = {
        id: makeId(),
        type: result.type || (isDouyin ? "douyin" : "url"),
        title: result.title || (isDouyin ? "抖音主页或作品链接" : "网页链接"),
        url,
        body: result.body || "",
        status: result.status || "已读取链接",
        limited: Boolean(result.limited)
      };
      setApiStatus(result.limited ? "链接受限" : "已读取链接", result.limited ? "offline" : "online");
    } catch (error) {
      console.warn(error);
      source = {
        id: makeId(),
        type: isDouyin ? "douyin" : "url",
        title: isDouyin ? "抖音主页或作品链接" : "网页链接",
        url,
        body: isDouyin
          ? "抖音主页链接已记录，但当前环境没有读取到作品列表。请粘贴作品标题、文案、标签或互动数据，以便完成风格学习。"
          : "网页链接已记录，但当前环境没有读取到正文。",
        status: isDouyin ? "抖音读取受限，需补充作品数据" : "读取受限，已记录链接",
        limited: true
      };
      setApiStatus("链接受限", "offline");
    }
    state.sources.push(source);
    els.urlInput.value = "";
    saveState();
    renderSources();
  });
}

function renderSources() {
  els.sourceCount.textContent = `${state.sources.length} 条材料`;
  if (!state.sources.length) {
    els.sourceList.innerHTML = '<div class="empty-state">还没有原稿</div>';
    return;
  }
  els.sourceList.innerHTML = state.sources
    .map(
      (source) => `
        <div class="source-item">
          <div>
            <strong>${escapeHtml(source.title)}</strong>
            <small>${sourceLabel(source)} · ${escapeHtml(source.status || "已加入")}</small>
          </div>
          <button class="ghost small" data-remove="${source.id}">删除</button>
        </div>
      `
    )
    .join("");
  els.sourceList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sources = state.sources.filter((source) => source.id !== button.dataset.remove);
      saveState();
      renderSources();
    });
  });
}

function sourceLabel(source) {
  if (source.type === "douyin") return "抖音链接";
  if (source.url) return "网页链接";
  if (source.size) return `${source.type.toUpperCase()} · ${formatSize(source.size)}`;
  return "文本";
}

async function analyzeAndGo(shouldNavigate = true) {
  if (!state.sources.length) {
    addDemoSource();
  }
  await withBusy(els.analyzeBtn, "正在读稿", async () => {
    try {
      setApiStatus("AI 分析中", "busy");
      const result = await postApi("/api/analyze", {
        sources: state.sources,
        rules: state.rules
      });
      state.profile = result.profile;
      setApiStatus("AI 后台", "online");
    } catch (error) {
      console.warn(error);
      state.profile = analyzeSources(state.sources, state.rules);
      setApiStatus("本地模式", "offline");
    }
    saveState();
    renderProfile();
    if (shouldNavigate) goStep("profile");
  });
}

function addDemoSource() {
  state.sources.push({
    id: makeId(),
    type: "demo",
    title: "示例原稿",
    status: "示例",
    body: "我通常会先提出一个清晰判断，再解释原因。内容创作不是堆观点，而是找到读者真的关心的问题。好的表达需要克制，也需要具体。"
  });
}

function analyzeSources(sources, rules) {
  const readableSources = sources.filter((source) => !isLimitedSource(source));
  const text = (readableSources.length ? readableSources : sources)
    .map((source) => `${source.title}\n${isLimitedSource(source) ? "" : source.body || ""}\n${source.url || ""}`)
    .join("\n");
  const hasDouyin = sources.some((source) => source.type === "douyin" || /抖音|视频|口播|账号|播放|点赞/.test(source.body || ""));
  const keywordCounts = extractKeywords(text);
  const domains = scoreDomains(text);
  const tones = scoreTones(text);
  const confidence = getConfidence(sources);

  return {
    confidence,
    tones,
    domains,
    keywords: keywordCounts,
    contentFeatures: buildContentFeatures(text, domains),
    textFeatures: buildTextFeatures(text, keywordCounts),
    videoFeatures: buildVideoFeatures(text, hasDouyin),
    trafficFeatures: buildTrafficFeatures(hasDouyin),
    rules,
    updatedAt: new Date().toISOString()
  };
}

function extractKeywords(text) {
  const normalized = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ");
  const bank = [
    "内容",
    "创作",
    "表达",
    "用户",
    "品牌",
    "传播",
    "视频",
    "账号",
    "抖音",
    "口播",
    "观点",
    "经验",
    "方法",
    "项目",
    "故事",
    "数据",
    "AI",
    "模型",
    "产品",
    "效率",
    "情绪",
    "读者",
    "标题",
    "评论",
    "流量"
  ];
  const counts = bank.map((word) => ({ word, count: countWord(normalized, word) })).filter((item) => item.count > 0);
  const chinese = normalized.replace(/\s+/g, "");
  const grams = {};
  for (let index = 0; index < chinese.length - 1; index += 1) {
    const gram = chinese.slice(index, index + 2);
    if (/^[\u4e00-\u9fa5]{2}$/.test(gram) && !isStopGram(gram)) {
      grams[gram] = (grams[gram] || 0) + 1;
    }
  }
  Object.entries(grams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([word, count]) => {
      if (!counts.some((item) => item.word === word)) counts.push({ word, count });
    });
  return counts.sort((a, b) => b.count - a.count).slice(0, 14);
}

function scoreDomains(text) {
  const scores = Object.entries(domainBanks).map(([name, words]) => ({
    name,
    value: words.reduce((sum, word) => sum + countWord(text, word), 0)
  }));
  const total = scores.reduce((sum, item) => sum + item.value, 0) || 1;
  return scores
    .map((item) => ({ ...item, percent: Math.max(8, Math.round((item.value / total) * 100)) }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 4);
}

function scoreTones(text) {
  const count = (words) => words.reduce((sum, word) => sum + countWord(text, word), 0);
  return {
    "理性": normalizeScore(count(["判断", "原因", "逻辑", "分析", "数据", "结构", "结论"]) + 3),
    "亲近": normalizeScore(count(["你", "我们", "朋友", "一起", "真实", "日常"]) + 2),
    "锋利": normalizeScore(count(["必须", "问题", "错", "关键", "本质", "不是"]) + 2),
    "克制": normalizeScore(count(["克制", "具体", "少", "清晰", "不要", "边界"]) + 3),
    "故事感": normalizeScore(count(["故事", "经历", "后来", "场景", "案例", "记得"]) + 2),
    "行动感": normalizeScore(count(["开始", "试试", "完成", "执行", "方法", "建议"]) + 2)
  };
}

function normalizeScore(value) {
  return Math.min(92, Math.max(34, value * 10 + 28));
}

function getConfidence(sources) {
  const readable = sources.filter((source) => source.body && !isLimitedSource(source)).length;
  const pending = sources.length - readable;
  if (readable >= 3 && pending === 0) return "高";
  if (readable >= 1 && pending <= readable) return "中";
  return "待补充";
}

function isLimitedSource(source) {
  return Boolean(source.limited) || /待后端|读取受限|需补充/.test(source.status || "");
}

function buildContentFeatures(text, domains) {
  const topDomain = domains[0]?.name || "内容创作";
  const features = [
    `主题重心偏向${topDomain}`,
    /观点|判断|本质|原因/.test(text) ? "偏观点表达，喜欢先给判断" : "偏信息整理，适合补充明确观点",
    /案例|故事|经历|场景/.test(text) ? "会借案例或场景展开" : "案例感偏弱，可在生成时补充具体场景",
    /方法|步骤|建议|清单/.test(text) ? "适合沉淀方法型内容" : "可加入清单结构提升可读性"
  ];
  return features;
}

function buildTextFeatures(text, keywords) {
  const avgSentence = estimateSentenceLength(text);
  return [
    avgSentence < 24 ? "句子偏短，适合保留轻快节奏" : "句子偏长，适合保留解释空间",
    keywords.length ? `高频词集中在「${keywords.slice(0, 3).map((item) => item.word).join("、")}」` : "高频词待补充",
    /？|\?/.test(text) ? "会用问题引入" : "可以增加问题式开头",
    /。/.test(text) ? "段落表达较稳定" : "需要在生成时主动整理段落"
  ];
}

function buildVideoFeatures(text, hasDouyin) {
  if (!hasDouyin) {
    return ["未读取到视频账号数据", "可补充抖音主页或口播稿", "后续接入后分析开头、字幕、时长、封面和互动"];
  }
  return [
    "优先学习高互动作品的标题和文案",
    "重点分析开头 3 秒钩子",
    "记录口播节奏、字幕密度和结尾引导",
    "接入后可比较高流量与低流量内容差异"
  ];
}

function buildTrafficFeatures(hasDouyin) {
  if (!hasDouyin) {
    return ["当前以文本表达为主", "传播线索需要更多账号数据", "可先按标题、关键词和结尾引导做轻量判断"];
  }
  return [
    "按播放、点赞、评论、收藏、转发排序抽样",
    "高流量内容用于提炼有效钩子",
    "低流量内容用于识别需要避开的表达",
    "评论区可作为后续选题来源"
  ];
}

function renderProfile() {
  const profile = state.profile || analyzeSources(state.sources, state.rules);
  els.confidenceLabel.textContent = `置信度：${profile.confidence}`;
  renderRadar(profile.tones);
  renderDonut(profile.domains);
  renderKeywords(profile.keywords);
  renderFeatureList(els.contentFeatures, profile.contentFeatures);
  renderFeatureList(els.textFeatures, profile.textFeatures);
  renderFeatureList(els.videoFeatures, profile.videoFeatures);
  renderFeatureList(els.trafficFeatures, profile.trafficFeatures);
  renderRules();
  renderSummary(profile);
}

function renderRadar(tones) {
  const center = 110;
  const radius = 72;
  const axes = toneAxes.map((name, index) => {
    const angle = (Math.PI * 2 * index) / toneAxes.length - Math.PI / 2;
    return {
      name,
      value: tones[name] || 40,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      labelX: center + Math.cos(angle) * 96,
      labelY: center + Math.sin(angle) * 96
    };
  });
  const rings = [0.33, 0.66, 1]
    .map((scale) => polygonPoints(axes.map((axis) => ({ x: center + (axis.x - center) * scale, y: center + (axis.y - center) * scale }))))
    .map((points) => `<polygon class="radar-axis" points="${points}"></polygon>`)
    .join("");
  const lines = axes
    .map((axis) => `<line class="radar-axis" x1="${center}" y1="${center}" x2="${axis.x}" y2="${axis.y}"></line>`)
    .join("");
  const shape = polygonPoints(
    axes.map((axis) => ({
      x: center + (axis.x - center) * (axis.value / 100),
      y: center + (axis.y - center) * (axis.value / 100)
    }))
  );
  const labels = axes
    .map((axis) => `<text class="radar-label" x="${axis.labelX}" y="${axis.labelY}" text-anchor="middle">${axis.name}</text>`)
    .join("");
  els.toneRadar.innerHTML = `${rings}${lines}<polygon class="radar-shape" points="${shape}"></polygon>${labels}`;
}

function renderDonut(domains) {
  const total = domains.reduce((sum, item) => sum + item.percent, 0) || 1;
  let start = 0;
  const gradients = domains.map((item, index) => {
    const portion = (item.percent / total) * 100;
    const segment = `${chartColors[index]} ${start}% ${start + portion}%`;
    start += portion;
    return segment;
  });
  els.domainDonut.style.background = `conic-gradient(${gradients.join(", ")})`;
  els.domainLegend.innerHTML = domains
    .map(
      (item, index) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${chartColors[index]}"></span>
        ${item.name} ${item.percent}%
      </div>
    `
    )
    .join("");
}

function renderKeywords(keywords) {
  if (!keywords.length) {
    els.keywordChips.innerHTML = '<span class="chip">等待更多文本</span>';
    return;
  }
  els.keywordChips.innerHTML = keywords
    .map((item) => `<span class="chip">${escapeHtml(item.word)} <strong>${item.count}</strong></span>`)
    .join("");
}

function renderFeatureList(element, items) {
  element.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function saveRulesFromInput() {
  const rules = splitRules(els.rulesInput.value);
  if (!rules.length) return;
  state.rules = unique([...state.rules, ...rules]);
  if (state.profile) state.profile.rules = state.rules;
  els.rulesInput.value = "";
  saveState();
  renderRules();
  renderSummary(state.profile || analyzeSources(state.sources, state.rules));
}

function renderRules() {
  els.ruleTags.innerHTML = state.rules.length
    ? state.rules.map((rule) => `<span class="rule-tag">${escapeHtml(rule)}</span>`).join("")
    : '<span class="rule-tag">还没有额外规则</span>';
}

function renderSummary(profile) {
  const keywords = profile.keywords.slice(0, 5).map((item) => item.word).join("、") || "待补充";
  const domains = profile.domains.slice(0, 2).map((item) => item.name).join("、") || "待补充";
  const rules = state.rules.slice(0, 3).join("；") || "暂无额外规则";
  els.profileSummary.innerHTML = `
    <div class="summary-line"><strong>领域：</strong>${escapeHtml(domains)}</div>
    <div class="summary-line"><strong>常用词：</strong>${escapeHtml(keywords)}</div>
    <div class="summary-line"><strong>气质：</strong>${topTones(profile.tones).join("、")}</div>
    <div class="summary-line"><strong>规则：</strong>${escapeHtml(rules)}</div>
  `;
}

async function sendProfileMessage() {
  const message = els.profileChatInput.value.trim();
  if (!message) return;
  state.profileChat.push({ role: "user", text: message });
  els.profileChatInput.value = "";
  renderChats();

  try {
    setApiStatus("AI 校准中", "busy");
    const result = await postApi("/api/refine-profile", {
      profile: state.profile || analyzeSources(state.sources, state.rules),
      message,
      rules: state.rules
    });
    state.profile = result.profile || state.profile;
    state.rules = result.rules || state.rules;
    state.profileChat.push({ role: "ai", text: result.reply || "已按你的反馈校准。" });
    setApiStatus("AI 后台", "online");
  } catch (error) {
    console.warn(error);
    const rules = splitRules(message);
    if (rules.length) {
      state.rules = unique([...state.rules, ...rules]);
    }
    state.profileChat.push({ role: "ai", text: "已记下。后续生成会按这条规则调整。" });
    setApiStatus("本地模式", "offline");
  }

  if (state.profile) state.profile.rules = state.rules;
  saveState();
  renderChats();
  renderRules();
  renderSummary(state.profile || analyzeSources(state.sources, state.rules));
}

function renderChats() {
  renderChatLog(els.profileChatLog, state.profileChat, "可以直接说：哪里不像你？");
  renderChatLog(els.deliverChatLog, state.deliverChat, "生成后，可以继续提出修改。");
}

function renderChatLog(element, messages, emptyText) {
  if (!messages.length) {
    element.innerHTML = `<div class="message ai">${emptyText}</div>`;
    return;
  }
  element.innerHTML = messages
    .map((message) => `<div class="message ${message.role === "user" ? "user" : "ai"}">${escapeHtml(message.text)}</div>`)
    .join("");
  element.scrollTop = element.scrollHeight;
}

async function generateDraft() {
  if (!state.profile) {
    state.profile = analyzeSources(state.sources, state.rules);
  }
  const task = els.taskInput.value.trim();
  if (!task) return;
  const type = document.querySelector('input[name="contentType"]:checked')?.value || "内容";
  await withBusy(els.generateBtn, "正在生成", async () => {
    try {
      setApiStatus("AI 生成中", "busy");
      state.draft = "";
      state.thinking = "";
      renderDraft();
      await streamApi("/api/generate-stream", {
        type,
        task,
        profile: state.profile,
        rules: state.rules
      }, {
        onThinking: (text) => {
          state.thinking += text;
          renderDraft();
        },
        onContent: (text) => {
          state.draft += text;
          renderDraft();
        }
      });
      state.deliverChat = [{ role: "ai", text: "初稿已生成。可以继续说要改哪里。" }];
      setApiStatus("AI 后台", "online");
    } catch (error) {
      console.warn(error);
      state.draft = composeDraft(type, task, state.profile, state.rules);
      state.thinking = "";
      state.deliverChat = [{ role: "ai", text: "初稿已生成。可以继续说要改哪里。" }];
      setApiStatus("本地模式", "offline");
    }
    saveState();
    renderDraft();
    renderChats();
  });
}

function composeDraft(type, task, profile, rules) {
  const tones = topTones(profile.tones).join("、");
  const keywords = profile.keywords.slice(0, 5).map((item) => item.word).join("、") || "表达、内容、读者";
  const ruleText = rules.length ? `\n\n写作规则：${rules.join("；")}。` : "";
  return `标题：先把问题说清楚\n\n${task}\n\n我会先给一个判断：这件事真正重要的，不是把话说得更满，而是让表达更像自己。\n\n如果是做${type}，第一步不是追求复杂，而是确认读者到底在意什么。一个好的内容，通常有三个层次：先提出问题，再给出判断，最后落到一个可执行的建议。\n\n这次内容可以围绕「${keywords}」展开。语气保持${tones}，少一点空泛，多一点具体。不要急着下结论，也不要把每句话都写成口号。\n\n最后留一个轻的互动：你最想保留自己的哪一种表达习惯？${ruleText}`;
}

async function sendDeliverMessage() {
  const message = els.deliverChatInput.value.trim();
  if (!message || !state.draft) return;
  const originalDraft = state.draft;
  state.deliverChat.push({ role: "user", text: message });
  els.deliverChatInput.value = "";
  renderChats();

  try {
    setApiStatus("AI 改稿中", "busy");
    state.draft = "";
    state.thinking = "";
    renderDraft();
    await streamApi("/api/revise-stream", {
      draft: originalDraft,
      instruction: message,
      profile: state.profile,
      rules: state.rules
    }, {
      onThinking: (text) => {
        state.thinking += text;
        renderDraft();
      },
      onContent: (text) => {
        state.draft += text;
        renderDraft();
      }
    });
    if (!state.draft.trim()) state.draft = originalDraft;
    state.deliverChat.push({ role: "ai", text: "已按你的意见修改。" });
    setApiStatus("AI 后台", "online");
  } catch (error) {
    console.warn(error);
    state.draft = reviseDraft(originalDraft, message);
    state.deliverChat.push({ role: "ai", text: "已按你的意见修改。你可以继续调整语气、结构或长度。" });
    setApiStatus("本地模式", "offline");
  }

  saveState();
  renderDraft();
  renderChats();
}

function reviseDraft(draft, instruction) {
  if (/短|精简|压缩/.test(instruction)) {
    return draft
      .split("\n\n")
      .filter((_, index) => index < 4)
      .join("\n\n");
  }
  if (/标题/.test(instruction)) {
    return draft.replace(/^标题：.+/, "标题：让表达回到你自己");
  }
  if (/锋利|观点/.test(instruction)) {
    return `${draft}\n\n补充观点：真正拉开差距的，不是会不会用 AI，而是你有没有一套稳定的判断。`;
  }
  if (/温和|柔和|克制/.test(instruction)) {
    return draft.replace(/我会先给一个判断：/, "可以先轻轻放下一个判断：");
  }
  return `${draft}\n\n修改说明：已记住「${instruction}」，下一版会继续按这个方向收紧。`;
}

function renderDraft() {
  els.draftStatus.textContent = state.draft ? "已生成" : "等待生成";
  els.draftOutput.textContent = state.draft || "初稿会显示在这里。";
  els.thinkingOutput.textContent = state.thinking || "";
  els.thinkingWrap.hidden = !state.thinking;
}

async function copyDraft() {
  if (!state.draft) return;
  try {
    await navigator.clipboard.writeText(state.draft);
    els.draftStatus.textContent = "已复制";
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = state.draft;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    els.draftStatus.textContent = "已复制";
  }
}

function downloadDraft(format) {
  if (!state.draft) return;
  const blob = new Blob([state.draft], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `content-simulator-draft.${format === "md" ? "md" : "txt"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function countWord(text, word) {
  if (!word) return 0;
  return (text.match(new RegExp(escapeRegExp(word), "gi")) || []).length;
}

function estimateSentenceLength(text) {
  const sentences = text.split(/[。！？.!?]/).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  return Math.round(sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length);
}

function splitRules(text) {
  return text
    .split(/[;\n；。]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function unique(items) {
  return Array.from(new Set(items));
}

function topTones(tones) {
  return Object.entries(tones)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

function polygonPoints(points) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function isStopGram(gram) {
  return ["的是", "一个", "这个", "我们", "可以", "不是", "自己", "用户", "内容"].includes(gram);
}

function formatSize(size) {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function checkApiHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
    if (!response.ok) throw new Error("health check failed");
    const data = await response.json();
    setApiStatus(data.configured ? "AI 后台" : "缺少 Key", data.configured ? "online" : "offline");
  } catch (_error) {
    setApiStatus("本地模式", "offline");
  }
}

async function postApi(path, payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data;
}

async function streamApi(path, payload, handlers) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      handleSsePart(part, handlers);
    }
  }
  if (buffer.trim()) handleSsePart(buffer, handlers);
}

function handleSsePart(part, handlers) {
  let event = "message";
  const dataLines = [];
  for (const line of part.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  const data = JSON.parse(dataLines.join("\n"));
  if (event === "thinking") handlers.onThinking?.(data.text || "");
  if (event === "content") handlers.onContent?.(data.text || "");
  if (event === "error") throw new Error(data.error || "Stream error");
}

async function withBusy(button, label, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function setApiStatus(text, mode) {
  if (!els.apiStatus) return;
  els.apiStatus.textContent = text;
  els.apiStatus.classList.remove("online", "offline", "busy");
  els.apiStatus.classList.add(mode || "offline");
}
