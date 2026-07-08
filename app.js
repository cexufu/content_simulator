const STORAGE_KEY = "content-simulator-state-v2";
const LEGACY_STORAGE_KEYS = ["content-simulator-state-v1"];
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
  focusNotes: "",
  currentWorkbench: "hotspot",
  selectedTopic: "",
  hotspotKeywords: "",
  hotspotTopics: [],
  hotspotStatus: "未生成前只展示流程，不输出默认选题。",
  hotspotMeta: null,
  initialDraft: "",
  evaluation: "",
  draft: "",
  finalized: false,
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
    "speechPatterns",
    "trafficFeatures",
    "focusTags",
    "focusInput",
    "saveFocusBtn",
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
    "relatedInfoList",
    "hotspotInput",
    "hotspotGenerateBtn",
    "hotspotStatus",
    "hotspotList",
    "researchInput",
    "researchBtn",
    "researchOutput",
    "initialDraftStatus",
    "initialDraftOutput",
    "evaluationStatus",
    "evaluationOutput",
    "draftStatus",
    "draftOutput",
    "thinkingWrap",
    "thinkingOutput",
    "copyBtn",
    "downloadTxtBtn",
    "downloadMdBtn",
    "downloadPdfBtn",
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
      focusNotes: "",
      currentWorkbench: "hotspot",
      selectedTopic: "",
      hotspotKeywords: "",
      hotspotTopics: [],
      hotspotStatus: "未生成前只展示流程，不输出默认选题。",
      hotspotMeta: null,
      initialDraft: "",
      evaluation: "",
      draft: "",
      finalized: false,
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
  els.saveFocusBtn.addEventListener("click", saveFocusNotes);
  els.saveRulesBtn.addEventListener("click", saveRulesFromInput);
  els.profileChatBtn.addEventListener("click", () => sendProfileMessage());
  els.profileChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendProfileMessage();
  });
  els.confirmProfileBtn.addEventListener("click", async () => {
    if (!state.profile) await analyzeAndGo(false);
    if (!state.profile) return;
    goStep("deliver");
  });
  els.generateBtn.addEventListener("click", () => generateDraft());
  els.hotspotGenerateBtn.addEventListener("click", () => generateHotspotTopics());
  els.hotspotInput.addEventListener("input", () => {
    state.hotspotKeywords = els.hotspotInput.value.trim();
  });
  els.hotspotList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-topic-action]");
    if (!button) return;
    const index = Number(button.dataset.topicIndex);
    const topic = state.hotspotTopics[index];
    if (!topic) return;
    if (button.dataset.topicAction === "research") runTopicResearch(topic.title);
    if (button.dataset.topicAction === "produce") useTopicForProduction(topic);
  });
  document.querySelectorAll(".workbench-tab").forEach((button) => {
    button.addEventListener("click", () => setWorkbench(button.dataset.workbench));
  });
  els.researchBtn.addEventListener("click", () => runTopicResearch(els.researchInput.value.trim()));
  els.deliverChatBtn.addEventListener("click", () => sendDeliverMessage());
  els.deliverChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendDeliverMessage();
  });
  els.copyBtn.addEventListener("click", copyDraft);
  els.downloadTxtBtn.addEventListener("click", () => downloadDraft("txt"));
  els.downloadMdBtn.addEventListener("click", () => downloadDraft("md"));
  els.downloadPdfBtn.addEventListener("click", downloadPdf);
  checkApiHealth();
}

function loadState() {
  LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
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
  const { hotspotTopics, hotspotStatus, hotspotMeta, ...persisted } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function renderAll() {
  renderConsent();
  renderStep();
  renderSources();
  renderProfile();
  renderWorkbench();
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
    const source = {
      id: makeId(),
      type: extension || "file",
      title: file.name,
      body: "",
      status: "解析中",
      size: file.size
    };
    state.sources.push(source);
    saveState();
    renderSources();
    try {
      const result = await parseUploadedFile(file, extension);
      Object.assign(source, {
        type: result.type || extension || "file",
        title: result.title || file.name,
        body: result.body || "",
        status: result.status || "已读取",
        limited: Boolean(result.limited)
      });
      setApiStatus(source.limited ? "文件需补充" : "文件已读取", source.limited ? "offline" : "online");
    } catch (error) {
      console.warn(error);
      Object.assign(source, fallbackFileSource(file, extension, error));
      setApiStatus("文件解析失败", "offline");
    }
    saveState();
    renderSources();
  }
}

async function parseUploadedFile(file, extension) {
  const data = await fileToBase64(file);
  return postApi("/api/parse-file", {
    name: file.name,
    extension,
    type: file.type,
    data
  });
}

function fallbackFileSource(file, extension, error) {
  return {
    type: extension || "file",
    title: file.name,
    body: `文件已记录，但没有解析出正文。请重新上传 docx、txt、md、html，或直接粘贴正文。错误：${error.message}`,
    status: "解析失败，需粘贴正文",
    limited: true
  };
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
  if (!hasReadableSource()) {
    setApiStatus("缺少正文", "offline");
    alert("没有读到可分析正文。请粘贴文章正文，或换一个可公开读取的新闻/文章链接。抖音主页和部分动态网页需要补充作品数据。");
    return;
  }
  await withBusy(els.analyzeBtn, "正在读稿", async () => {
    try {
      setApiStatus("AI 分析中", "busy");
      const result = await postApi("/api/analyze", {
        sources: state.sources,
        rules: state.rules
      });
      state.profile = result.profile;
      resetHotspotResults("画像已更新，可以生成新的热点选题。");
      setApiStatus("AI 后台", "online");
    } catch (error) {
      console.warn(error);
      setApiStatus("分析失败", "offline");
      alert(error.message || "AI 分析失败，请检查后端 Key 和链接内容。");
      return;
    }
    saveState();
    renderProfile();
    if (shouldNavigate) goStep("profile");
  });
}

function hasReadableSource() {
  return state.sources.some((source) => source.body && !isLimitedSource(source));
}

function analyzeSources(sources, rules) {
  const readableSources = sources.filter((source) => !isLimitedSource(source));
  const text = (readableSources.length ? readableSources : sources)
    .map((source) => `${source.title}\n${isLimitedSource(source) ? "" : source.body || ""}\n${source.url || ""}`)
    .join("\n");
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
    speechPatterns: buildSpeechPatterns(text),
    trafficFeatures: buildTrafficFeatures(text),
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
  const matched = scores.filter((item) => item.value > 0);
  if (!matched.length) return [];
  const total = matched.reduce((sum, item) => sum + item.value, 0) || 1;
  return matched
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
  const topDomain = domains[0]?.name || "待补充";
  const features = [
    topDomain === "待补充" ? "主题重心待继续学习" : `主题重心偏向${topDomain}`,
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

function buildSpeechPatterns(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLines = lines.slice(0, 8).join(" ");
  const lastLines = lines.slice(-8).join(" ");
  const opening = /大家好|我是|今天|最近|先说|先讲|很多人|你有没有|有没有发现/.test(firstLines)
    ? "开场有固定进入方式，适合保留原有起手句"
    : "开场方式待补充，可继续学习原稿开头";
  const intro = /我是|这里是|关注我|我的名字|我叫/.test(text)
    ? "存在自我介绍或账号身份提示"
    : "暂未识别明显自我介绍";
  const transition = /所以|但是|不过|然后|接下来|换句话说|说白了|也就是说|重点是|问题是/.test(text)
    ? "常用过渡词较明显，可用于承接观点"
    : "转场/过渡表达待继续学习";
  const ending = /最后|总结|总之|欢迎|评论区|关注|下期|你怎么看|留言/.test(lastLines)
    ? "结尾有互动或总结倾向"
    : "结尾收束方式待补充";
  const catchphrase = extractRepeatedPhrase(lines);
  return [opening, intro, transition, ending, catchphrase].filter(Boolean).slice(0, 5);
}

function extractRepeatedPhrase(lines) {
  const candidates = {};
  for (const line of lines) {
    const segments = line
      .split(/[，。！？；、,.!?;\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 10);
    for (const segment of segments) {
      if (/^(这个|那个|然后|所以|但是|因为|如果|就是)$/.test(segment)) continue;
      candidates[segment] = (candidates[segment] || 0) + 1;
    }
  }
  const repeated = Object.entries(candidates)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])[0];
  return repeated ? `疑似口头禅/固定表达：「${repeated[0]}」` : "口头禅和固定表达待更多样本确认";
}

function buildTrafficFeatures(text) {
  return [
    /标题|开头|问题|为什么/.test(text) ? "开头和标题可作为传播抓手" : "传播抓手待更多样本确认",
    /评论|留言|你怎么看|欢迎/.test(text) ? "有互动引导倾向" : "互动引导暂不明显",
    /热点|最近|今天|当下|趋势/.test(text) ? "会借近期议题进入" : "近期议题借势不明显"
  ];
}

function renderProfile() {
  if (!state.profile) {
    renderEmptyProfile();
    return;
  }
  const profile = state.profile;
  els.confidenceLabel.textContent = `置信度：${profile.confidence}`;
  renderRadar(profile.tones);
  renderDonut(profile.domains);
  renderKeywords(profile.keywords);
  renderFeatureList(els.contentFeatures, profile.contentFeatures);
  renderFeatureList(els.textFeatures, profile.textFeatures);
  renderFeatureList(els.speechPatterns, profile.speechPatterns || buildSpeechPatterns(""));
  renderFeatureList(els.trafficFeatures, profile.trafficFeatures);
  renderFocusProfile(profile);
  renderRules();
  renderSummary(profile);
  renderWorkbench();
}

function renderEmptyProfile() {
  els.confidenceLabel.textContent = hasReadableSource() ? "待分析" : "未读到正文";
  els.toneRadar.innerHTML = '<text class="radar-label" x="110" y="112" text-anchor="middle">待学习</text>';
  els.domainDonut.style.background = "#ebe5d8";
  els.domainLegend.innerHTML = '<div class="legend-item"><span class="legend-dot"></span>缺少可分析文本</div>';
  els.keywordChips.innerHTML = '<span class="chip">请补充正文</span><span class="chip">或换可读取链接</span>';
  renderFeatureList(els.contentFeatures, ["没有读取到可分析正文"]);
  renderFeatureList(els.textFeatures, ["请粘贴文章正文、口播稿或上传 txt / md / html"]);
  renderFeatureList(els.speechPatterns, ["补充正文后分析开场、结尾、转场和口头禅"]);
  renderFeatureList(els.trafficFeatures, ["动态网页需要公开正文或专门连接器"]);
  renderFocusProfile(null);
  renderRules();
  els.profileSummary.innerHTML = `
    <div class="summary-line"><strong>状态：</strong>还没有形成可确认的风格画像。</div>
    <div class="summary-line"><strong>处理：</strong>回到原稿收集区，补充正文后再开始读稿。</div>
  `;
}

function renderFocusProfile(profile) {
  const focus = getFocusContext(profile);
  const tags = [
    ...focus.domains.map((item) => `领域：${item}`),
    ...focus.topics.map((item) => `话题：${item}`),
    ...focus.platforms.map((item) => `平台：${item}`)
  ].slice(0, 12);
  els.focusTags.innerHTML = tags.length
    ? tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")
    : '<span class="chip">等待补充关注方向</span>';
  if (document.activeElement !== els.focusInput) {
    els.focusInput.value = state.focusNotes || "";
  }
}

function getFocusContext(profile = state.profile) {
  const safeProfile = profile || {};
  const domains = (safeProfile.domains || []).slice(0, 3).map((item) => item.name).filter(Boolean);
  const topics = (safeProfile.keywords || []).slice(0, 6).map((item) => item.word).filter(Boolean);
  const sourceText = state.sources.map((source) => `${source.title} ${source.body || ""}`).join(" ");
  const platforms = [];
  if (/公众号|微信/.test(sourceText)) platforms.push("公众号");
  if (/小红书/.test(sourceText)) platforms.push("小红书");
  if (/口播|短视频|抖音/.test(sourceText)) platforms.push("口播/短视频");
  return {
    domains,
    topics,
    platforms,
    notes: state.focusNotes || ""
  };
}

function saveFocusNotes() {
  state.focusNotes = els.focusInput.value.trim();
  resetHotspotResults("关注画像已更新，可以重新生成热点选题。");
  saveState();
  renderFocusProfile(state.profile);
  renderWorkbench();
}

function setWorkbench(name) {
  state.currentWorkbench = name || "hotspot";
  saveState();
  renderWorkbench();
}

function renderWorkbench() {
  if (!els.relatedInfoList) return;
  const current = state.currentWorkbench || "hotspot";
  document.querySelectorAll(".workbench-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.workbench === current);
  });
  document.querySelectorAll(".workbench-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === current);
  });
  renderRelatedInfo();
  renderHotspotTopics();
  if (!els.researchOutput.innerHTML.trim()) {
    renderTopicResearch(state.selectedTopic || "");
  }
}

function renderRelatedInfo() {
  const focus = getFocusContext();
  const topic = focus.topics[0] || focus.domains[0] || state.focusNotes || "";
  const domain = focus.domains[0] || state.focusNotes || "";
  if (!topic && !domain) {
    els.relatedInfoList.innerHTML = '<div class="empty-state">确认风格或补充关注画像后，再推荐相关信息。</div>';
    return;
  }
  const items = [
    {
      source: "公开新闻检索",
      title: `${topic} 相关新闻`,
      body: `查看「${topic}」近期新闻、公共讨论和背景信息。`,
      url: buildNewsSearchUrl(`${topic} 新闻`)
    },
    {
      source: "领域动态",
      title: `${domain || topic} 行业动态`,
      body: `围绕「${domain || topic}」补充行业变化、案例和趋势材料。`,
      url: buildNewsSearchUrl(`${domain || topic} 行业动态`)
    },
    {
      source: "热榜入口",
      title: "今日热点与平台讨论",
      body: "查看全网热榜，判断今天有哪些公共议题和平台情绪。",
      url: "https://tophub.today/"
    }
  ];
  els.relatedInfoList.innerHTML = items
    .map(
      (item) => `
        <a class="news-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span>${escapeHtml(item.source)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
        </a>
      `
    )
    .join("");
}

function buildNewsSearchUrl(query) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
}

function renderHotspotTopics() {
  if (els.hotspotInput && document.activeElement !== els.hotspotInput) {
    els.hotspotInput.value = state.hotspotKeywords || "";
  }
  if (els.hotspotStatus) {
    const meta = state.hotspotMeta?.sourceCount;
    const sourceText = meta ? ` 来源：TopHub ${meta.topHub || 0} 条 / 搜索 ${meta.search || 0} 条。` : "";
    els.hotspotStatus.textContent = `${state.hotspotStatus || "未生成前只展示流程，不输出默认选题。"}${sourceText}`;
  }
  const topics = state.hotspotTopics.length ? state.hotspotTopics : buildHotspotTopics();
  els.hotspotList.innerHTML = topics.map((item, index) => item.framework ? renderHotspotFramework(item) : renderHotspotCard(item, index)).join("");
}

function buildHotspotTopics() {
  return [
    {
      title: "1. 先确认用户输入",
      body: "读取用户旧稿、关注画像、平台方向、目标读者和本次任务；信息不足时停留等待，不输出默认选题。"
    },
    {
      title: "2. 双渠道收集热点",
      body: "同时读取 TopHub 和公开搜索，两个渠道平级处理；保留来源、时间、热度或可核验依据。"
    },
    {
      title: "3. 结合用户画像筛选",
      body: "按领域契合、平台适配、受众相关性、传播价值、风险程度过滤，只留下适合该用户的真实选题。"
    },
    {
      title: "4. 输出选题池",
      body: "每个选题应包含话题标题、来源、热度/依据、推荐切口、适配理由和风险提示。"
    }
  ];
}

function renderHotspotFramework(item) {
  return `
    <div class="topic-item">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
    </div>
  `;
}

function renderHotspotCard(item, index) {
  const scores = item.scores || {};
  const sourceLinks = (item.referenceUrls || [])
    .map((url, linkIndex) => {
      const href = safeUrl(url);
      if (!href) return "";
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">来源${linkIndex + 1}</a>`;
    })
    .filter(Boolean)
    .join("");
  return `
    <div class="topic-item topic-result">
      <div class="topic-rank">Top ${item.rank || index + 1}</div>
      <strong>${escapeHtml(item.title)}</strong>
      <div class="topic-score-row">
        <span>总分 ${formatScore(scores.total)}</span>
        <span>新闻性 ${formatScore(scores.newsworthiness)}</span>
        <span>契合 ${formatScore(scores.userFit)}</span>
        <span>传播 ${formatScore(scores.spreadValue)}</span>
      </div>
      ${item.sourceSummary ? `<p>${escapeHtml(item.sourceSummary)}</p>` : ""}
      ${item.newsValue ? `<p><b>新闻性：</b>${escapeHtml(item.newsValue)}</p>` : ""}
      ${item.fitReason ? `<p><b>适配：</b>${escapeHtml(item.fitReason)}</p>` : ""}
      ${item.suggestedAngle ? `<p><b>切口：</b>${escapeHtml(item.suggestedAngle)}</p>` : ""}
      ${item.riskNote ? `<p><b>边界：</b>${escapeHtml(item.riskNote)}</p>` : ""}
      ${sourceLinks ? `<div class="topic-sources">${sourceLinks}</div>` : ""}
      <div class="topic-actions">
        <button class="ghost small" data-topic-action="research" data-topic-index="${index}">钻探</button>
        <button class="secondary small" data-topic-action="produce" data-topic-index="${index}">写这个</button>
      </div>
    </div>
  `;
}

async function generateHotspotTopics() {
  const keywords = (els.hotspotInput.value || "").trim();
  state.hotspotKeywords = keywords;
  if (!hasHotspotSignal(keywords)) {
    state.hotspotTopics = [];
    state.hotspotStatus = "请先确认风格画像，或输入关注话题/关键词。";
    state.hotspotMeta = null;
    renderHotspotTopics();
    return;
  }
  await withBusy(els.hotspotGenerateBtn, "生成中", async () => {
    try {
      setApiStatus("读取热点", "busy");
      resetHotspotResults("正在读取 TopHub 和公开搜索...");
      renderHotspotTopics();
      const result = await postApi("/api/hotspot-topics", {
        profile: state.profile || {},
        focusProfile: getFocusContext(),
        rules: state.rules,
        keywords
      });
      state.hotspotTopics = Array.isArray(result.topics) ? result.topics : [];
      state.hotspotMeta = {
        sourceCount: result.sourceCount || null,
        missingSources: result.missingSources || []
      };
      state.hotspotStatus = state.hotspotTopics.length
        ? `已生成 Top${state.hotspotTopics.length}。${result.bestTopicReason || ""}`.trim()
        : (result.message || "没有读取到可核验热点，暂不生成选题。");
      setApiStatus("AI 后台", "online");
    } catch (error) {
      console.warn(error);
      state.hotspotTopics = [];
      state.hotspotMeta = null;
      state.hotspotStatus = error.message || "热点选题生成失败。";
      setApiStatus("热点失败", "offline");
    }
    saveState();
    renderHotspotTopics();
  });
}

function hasHotspotSignal(keywords) {
  const focus = getFocusContext();
  return Boolean(
    keywords ||
    focus.notes ||
    focus.domains.length ||
    focus.topics.length
  );
}

function resetHotspotResults(status) {
  state.hotspotTopics = [];
  state.hotspotMeta = null;
  state.hotspotStatus = status || "未生成前只展示流程，不输出默认选题。";
}

function runTopicResearch(topic) {
  const currentTopic = topic || state.selectedTopic || getFocusContext().topics[0] || "";
  if (!currentTopic) {
    els.researchOutput.innerHTML = '<div class="empty-state">先输入一个具体话题，再开始钻探。</div>';
    return;
  }
  state.selectedTopic = currentTopic;
  saveState();
  renderTopicResearch(currentTopic);
}

function renderTopicResearch(topic) {
  const currentTopic = topic || state.selectedTopic || "";
  if (!currentTopic) {
    els.researchOutput.innerHTML = '<div class="empty-state">先选择或输入一个话题。</div>';
    return;
  }
  const blocks = [
    {
      title: "谁做过了",
      body: `同类内容通常会围绕「${currentTopic}」的热点事实、经验总结、情绪共鸣来写。`
    },
    {
      title: "为什么容易火",
      body: "容易火的内容往往有明确冲突、具体人物、强场景和可转述的观点。"
    },
    {
      title: "还缺什么角度",
      body: "可以找更小的人群、更真实的细节、更长期的问题，避开只复述热点。"
    },
    {
      title: "建议切入口",
      body: `从「一个具体人/一件具体事/一个被忽略的变化」切入，再结合你的文风展开。`
    }
  ];
  els.researchOutput.innerHTML = blocks
    .map((item) => `<div class="research-block"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></div>`)
    .join("");
}

function useTopicForProduction(topic) {
  const title = typeof topic === "string" ? topic : topic?.title;
  const angle = typeof topic === "string" ? "" : topic?.suggestedAngle;
  const text = `围绕「${title}」写一篇内容。要求：有具体切口，不要泛泛而谈，最后输出适合我风格的版本。${angle ? `建议切口：${angle}` : ""}`;
  els.taskInput.value = text;
  state.selectedTopic = title;
  setWorkbench("produce");
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
  renderSummary(state.profile);
}

function renderRules() {
  els.ruleTags.innerHTML = state.rules.length
    ? state.rules.map((rule) => `<span class="rule-tag">${escapeHtml(rule)}</span>`).join("")
    : '<span class="rule-tag">还没有额外规则</span>';
}

function renderSummary(profile) {
  if (!profile) {
    els.profileSummary.innerHTML = `
      <div class="summary-line"><strong>状态：</strong>还没有确认风格画像。</div>
      <div class="summary-line"><strong>处理：</strong>请先在原稿区点击“开始读稿”。</div>
    `;
    return;
  }
  const keywords = profile.keywords.slice(0, 5).map((item) => item.word).join("、") || "待补充";
  const domains = profile.domains.slice(0, 2).map((item) => item.name).join("、") || "待补充";
  const speech = (profile.speechPatterns || []).slice(0, 2).join("；") || "待补充";
  const rules = state.rules.slice(0, 3).join("；") || "暂无额外规则";
  els.profileSummary.innerHTML = `
    <div class="summary-line"><strong>领域：</strong>${escapeHtml(domains)}</div>
    <div class="summary-line"><strong>常用词：</strong>${escapeHtml(keywords)}</div>
    <div class="summary-line"><strong>气质：</strong>${topTones(profile.tones).join("、")}</div>
    <div class="summary-line"><strong>话术：</strong>${escapeHtml(speech)}</div>
    <div class="summary-line"><strong>规则：</strong>${escapeHtml(rules)}</div>
  `;
}

async function sendProfileMessage() {
  const message = els.profileChatInput.value.trim();
  if (!message) return;
  state.profileChat.push({ role: "user", text: message });
  els.profileChatInput.value = "";
  renderChats();

  if (!state.profile && !hasReadableSource()) {
    state.profileChat.push({ role: "ai", text: "还没有读到可分析正文。请先补充原稿正文，或换一个可公开读取的文章链接。" });
    saveState();
    renderChats();
    renderProfile();
    return;
  }

  try {
    setApiStatus("AI 校准中", "busy");
    const result = await postApi("/api/refine-profile", {
      profile: state.profile || {},
      message,
      rules: state.rules
    });
    state.profile = result.profile || state.profile;
    state.rules = result.rules || state.rules;
    resetHotspotResults("画像已校准，可以重新生成热点选题。");
    state.profileChat.push({ role: "ai", text: result.reply || "已按你的反馈校准。" });
    setApiStatus("AI 后台", "online");
  } catch (error) {
    console.warn(error);
    const rules = splitRules(message);
    if (rules.length) {
      state.rules = unique([...state.rules, ...rules]);
    }
    state.profileChat.push({ role: "ai", text: rules.length ? "模型校准失败，但已把这句话保存为额外规则。" : "模型校准失败，请稍后重试。" });
    setApiStatus("校准失败", "offline");
  }

  if (state.profile) state.profile.rules = state.rules;
  saveState();
  renderChats();
  renderRules();
  renderSummary(state.profile);
  renderFocusProfile(state.profile);
  renderWorkbench();
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
    await analyzeAndGo(false);
    if (!state.profile) return;
  }
  const task = els.taskInput.value.trim();
  if (!task) return;
  const type = document.querySelector('input[name="contentType"]:checked')?.value || "内容";
  await withBusy(els.generateBtn, "正在生成", async () => {
    try {
      setApiStatus("AI 工作流", "busy");
      state.initialDraft = "";
      state.evaluation = "";
      state.draft = "";
      state.finalized = false;
      state.thinking = "";
      renderDraft();
      await streamApi("/api/workflow-stream", {
        type,
        task,
        profile: state.profile,
        focusProfile: getFocusContext(),
        rules: state.rules
      }, {
        onThinking: (text) => {
          state.thinking += text;
          renderDraft();
        },
        onDraft: (text) => {
          state.initialDraft += text;
          renderDraft();
        },
        onEvaluation: (text) => {
          state.evaluation += text;
          renderDraft();
        },
        onFinal: (text) => {
          state.draft += text;
          renderDraft();
        }
      });
      state.deliverChat = [{ role: "ai", text: "优化稿已生成。可以继续说要改哪里，确认时说“好的”。" }];
      setApiStatus("AI 后台", "online");
    } catch (error) {
      console.warn(error);
      state.initialDraft = "";
      state.evaluation = "";
      state.draft = "";
      state.finalized = false;
      state.thinking = "";
      state.deliverChat = [{ role: "ai", text: "生成失败，未使用本地模板兜底。请检查后台连接后重试。" }];
      setApiStatus("生成失败", "offline");
    }
    saveState();
    renderDraft();
    renderChats();
  });
}

async function sendDeliverMessage() {
  const message = els.deliverChatInput.value.trim();
  if (!message || !state.draft) return;
  const originalDraft = state.draft;
  state.deliverChat.push({ role: "user", text: message });
  els.deliverChatInput.value = "";
  renderChats();

  if (isFinalApproval(message)) {
    await finalizeDraft(originalDraft, message);
    return;
  }

  try {
    setApiStatus("AI 改稿中", "busy");
    state.draft = "";
    state.finalized = false;
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
    state.finalized = false;
    state.deliverChat.push({ role: "ai", text: "已按你的意见修改。" });
    setApiStatus("AI 后台", "online");
  } catch (error) {
    console.warn(error);
    state.draft = originalDraft;
    state.finalized = false;
    state.deliverChat.push({ role: "ai", text: "改稿失败，已保留原稿，请检查后台连接后重试。" });
    setApiStatus("改稿失败", "offline");
  }

  saveState();
  renderDraft();
  renderChats();
}

async function finalizeDraft(originalDraft, message) {
  try {
    setApiStatus("整理最终版", "busy");
    state.draft = "";
    state.finalized = false;
    state.thinking = "";
    renderDraft();
    await streamApi("/api/revise-stream", {
      draft: originalDraft,
      instruction: buildFinalInstruction(message),
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
    if (!state.draft.trim()) state.draft = cleanFinalDraft(originalDraft);
    state.draft = cleanFinalDraft(state.draft);
    state.finalized = true;
    state.deliverChat.push({ role: "ai", text: "已生成最终清洁版，可直接下载。" });
    setApiStatus("AI 后台", "online");
  } catch (error) {
    console.warn(error);
    state.draft = originalDraft;
    state.finalized = false;
    state.deliverChat.push({ role: "ai", text: "最终版整理失败，已保留上一版，请检查后台连接后重试。" });
    setApiStatus("整理失败", "offline");
  }

  saveState();
  renderDraft();
  renderChats();
}

function isFinalApproval(message) {
  const cleaned = message.toLowerCase().replace(/[，。！？、,.!?\s]/g, "");
  return [
    "好",
    "好的",
    "可以",
    "可以了",
    "行",
    "行了",
    "就这样",
    "确认",
    "确认了",
    "定稿",
    "定了",
    "没问题",
    "完成",
    "通过",
    "满意",
    "ok",
    "okay",
    "好的就这样",
    "可以定稿"
  ].includes(cleaned);
}

function buildFinalInstruction(message) {
  return [
    `用户确认语：${message}`,
    "用户已经确认当前最后版本。",
    "请基于当前稿件重新整理一份完整清洁版。",
    "不要输出解释、修改说明、寒暄、Markdown 代码块或对话内容。",
    "保留标题和正文；修正明显重复、断裂、空行混乱和临时稿痕迹。",
    "只输出最终可交付正文。"
  ].join("\n");
}

function cleanFinalDraft(draft) {
  return String(draft || "")
    .replace(/^```[a-zA-Z]*\s*/g, "")
    .replace(/```$/g, "")
    .replace(/^\s*(以下是|这是|好的，?下面是|已为你整理).*?[:：]\s*/i, "")
    .replace(/\n\s*修改说明[:：][\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderDraft() {
  els.initialDraftStatus.textContent = state.initialDraft ? "已生成" : "等待生成";
  els.initialDraftOutput.textContent = state.initialDraft || "内容初稿会显示在这里。";
  els.evaluationStatus.textContent = state.evaluation ? "已评分" : "等待评分";
  els.evaluationOutput.textContent = state.evaluation || "五维评分会显示在这里。";
  els.draftStatus.textContent = state.finalized ? "最终清洁版" : state.draft ? "已生成" : "等待生成";
  els.draftOutput.textContent = state.draft || "文风优化稿会显示在这里。";
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
  anchor.download = `content-simulator-${state.finalized ? "final" : "draft"}.${format === "md" ? "md" : "txt"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadPdf() {
  if (!state.draft) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.print();
    return;
  }
  const title = state.finalized ? "Content Simulator 最终稿" : "Content Simulator 初稿";
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 32px; color: #1f2420; }
          pre { white-space: pre-wrap; word-break: break-word; font: inherit; line-height: 1.75; }
        </style>
      </head>
      <body>
        <pre>${escapeHtml(state.draft)}</pre>
        <script>window.onload = () => window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
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
    setApiStatus("后台离线", "offline");
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
  if (event === "draftContent") handlers.onDraft?.(data.text || "");
  if (event === "evaluationContent") handlers.onEvaluation?.(data.text || "");
  if (event === "finalContent") handlers.onFinal?.(data.text || "");
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
