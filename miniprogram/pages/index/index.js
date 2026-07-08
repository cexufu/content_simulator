const api = require("../../utils/api");

const STORAGE_KEY = "content-simulator-miniprogram-state-v2";
const LEGACY_STORAGE_KEYS = ["content-simulator-miniprogram-state-v1"];
const DEFAULT_PROFILE = {
  confidence: "",
  tones: {},
  domains: [],
  keywords: [],
  contentFeatures: [],
  textFeatures: [],
  speechPatterns: [],
  trafficFeatures: []
};

Page({
  data: {
    showConsent: true,
    currentStep: "collect",
    apiStatus: "连接中",
    apiStatusMode: "busy",
    textInput: "",
    urlInput: "",
    sources: [],
    profile: DEFAULT_PROFILE,
    toneItems: [],
    keywordTags: [],
    focusNotes: "",
    focusTags: [],
    rulesInput: "",
    rules: [],
    profileMessage: "",
    profileChat: [],
    workbenchTab: "hotspot",
    relatedInfo: [],
    hotspotKeywordInput: "",
    hotspotTopics: [],
    hotspotStatus: "未生成前只展示流程，不输出默认选题。",
    researchInput: "",
    researchBlocks: [],
    selectedTopic: "",
    contentTypes: ["公众号", "口播稿", "小红书", "朋友圈"],
    contentType: "公众号",
    taskInput: "",
    initialDraft: "",
    evaluation: "",
    draft: "",
    finalized: false,
    thinking: "",
    draftStatus: "等待生成",
    deliverMessage: "",
    deliverChat: [],
    urlLoading: false,
    fileLoading: false,
    analyzeLoading: false,
    profileChatLoading: false,
    hotspotLoading: false,
    generateLoading: false,
    deliverChatLoading: false
  },

  streamBuffer: null,
  flushTimer: null,

  onLoad() {
    this.restoreState();
    this.refreshDerivedData();
    this.checkHealth();
  },

  restoreState() {
    LEGACY_STORAGE_KEYS.forEach((key) => wx.removeStorageSync(key));
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (!saved) return;
    this.setData({
      ...saved,
      profile: saved.profile || DEFAULT_PROFILE,
      showConsent: saved.showConsent !== false
    });
  },

  saveState() {
    const keys = [
      "showConsent",
      "currentStep",
      "sources",
      "profile",
      "focusNotes",
      "rules",
      "profileChat",
      "workbenchTab",
      "selectedTopic",
      "contentType",
      "taskInput",
      "initialDraft",
      "evaluation",
      "draft",
      "finalized",
      "thinking",
      "deliverChat"
    ];
    const state = {};
    keys.forEach((key) => {
      state[key] = this.data[key];
    });
    wx.setStorageSync(STORAGE_KEY, state);
  },

  acceptConsent() {
    this.setData({ showConsent: false });
    this.saveState();
  },

  openPrivacyPage() {
    wx.navigateTo({ url: "/pages/privacy/privacy" });
  },

  clearLocalData() {
    wx.showModal({
      title: "清空本地数据",
      content: "确认清空已缓存的原稿、画像和草稿？",
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync(STORAGE_KEY);
        this.setData({
          currentStep: "collect",
          textInput: "",
          urlInput: "",
          sources: [],
          profile: DEFAULT_PROFILE,
          toneItems: [],
          keywordTags: [],
          focusNotes: "",
          focusTags: [],
          rulesInput: "",
          rules: [],
          profileMessage: "",
          profileChat: [],
          workbenchTab: "hotspot",
          relatedInfo: [],
          hotspotKeywordInput: "",
          hotspotTopics: buildHotspotTopics(),
          hotspotStatus: "未生成前只展示流程，不输出默认选题。",
          researchInput: "",
          researchBlocks: [],
          selectedTopic: "",
          taskInput: "",
          initialDraft: "",
          evaluation: "",
          draft: "",
          finalized: false,
          thinking: "",
          draftStatus: "等待生成",
          deliverMessage: "",
          deliverChat: []
        });
        this.refreshDerivedData();
        wx.showToast({ title: "已清空", icon: "none" });
      }
    });
  },

  goStep(event) {
    this.setData({ currentStep: event.currentTarget.dataset.step });
    this.saveState();
  },

  onTextInput(event) {
    this.setData({ textInput: event.detail.value });
  },

  onUrlInput(event) {
    this.setData({ urlInput: event.detail.value });
  },

  onFocusInput(event) {
    this.setData({ focusNotes: event.detail.value });
  },

  onRulesInput(event) {
    this.setData({ rulesInput: event.detail.value });
  },

  onProfileMessageInput(event) {
    this.setData({ profileMessage: event.detail.value });
  },

  onResearchInput(event) {
    this.setData({ researchInput: event.detail.value });
  },

  onTaskInput(event) {
    this.setData({ taskInput: event.detail.value });
  },

  onDeliverMessageInput(event) {
    this.setData({ deliverMessage: event.detail.value });
  },

  async checkHealth() {
    try {
      const result = await api.request("/api/health", {}, { method: "GET", timeout: 12000 });
      this.setData({
        apiStatus: result.configured ? "AI 后台" : "缺少 Key",
        apiStatusMode: result.configured ? "online" : "offline"
      });
    } catch (_error) {
      this.setData({ apiStatus: "连接失败", apiStatusMode: "offline" });
    }
  },

  addTextSource() {
    const text = this.data.textInput.trim();
    if (!text) return;
    const sources = this.data.sources.concat({
      id: makeId(),
      type: "text",
      title: `粘贴原稿 ${this.data.sources.length + 1}`,
      body: text,
      status: "已读取",
      limited: false
    });
    this.setData({ sources, textInput: "" });
    this.saveState();
  },

  async addUrlSource() {
    const url = this.data.urlInput.trim();
    if (!url || this.data.urlLoading) return;
    this.setData({ urlLoading: true, apiStatus: "读取链接", apiStatusMode: "busy" });
    try {
      const result = await api.request("/api/resolve-url", { url }, { timeout: 45000 });
      const sources = this.data.sources.concat({
        id: makeId(),
        type: result.type || "url",
        title: result.title || "网页链接",
        url,
        body: result.body || "",
        status: result.status || "已读取链接",
        limited: Boolean(result.limited)
      });
      this.setData({
        sources,
        urlInput: "",
        apiStatus: result.limited ? "链接受限" : "已读取链接",
        apiStatusMode: result.limited ? "offline" : "online"
      });
      this.saveState();
    } catch (error) {
      wx.showToast({ title: error.message || "读取失败", icon: "none" });
      this.setData({ apiStatus: "链接失败", apiStatusMode: "offline" });
    } finally {
      this.setData({ urlLoading: false });
    }
  },

  chooseFiles() {
    if (this.data.fileLoading) return;
    wx.chooseMessageFile({
      count: 5,
      type: "file",
      success: async (res) => {
        const files = res.tempFiles || [];
        if (!files.length) return;
        this.setData({ fileLoading: true, apiStatus: "解析文件", apiStatusMode: "busy" });
        try {
          for (const file of files) {
            await this.parseMiniFile(file);
          }
          this.setData({ apiStatus: "文件已读取", apiStatusMode: "online" });
          this.saveState();
        } catch (error) {
          wx.showToast({ title: error.message || "文件解析失败", icon: "none" });
          this.setData({ apiStatus: "文件失败", apiStatusMode: "offline" });
        } finally {
          this.setData({ fileLoading: false });
        }
      },
      fail: () => {
        wx.showToast({ title: "未选择文件", icon: "none" });
      }
    });
  },

  parseMiniFile(file) {
    return new Promise((resolve, reject) => {
      const name = file.name || "未命名文件";
      const extension = getExtension(name);
      wx.getFileSystemManager().readFile({
        filePath: file.path,
        encoding: "base64",
        success: async (res) => {
          try {
            const result = await api.request("/api/parse-file", {
              name,
              extension,
              data: res.data
            }, { timeout: 60000 });
            const sources = this.data.sources.concat({
              id: makeId(),
              type: result.type || extension || "file",
              title: result.title || name,
              body: result.body || "",
              status: result.status || "已读取",
              limited: Boolean(result.limited)
            });
            this.setData({ sources });
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        fail: () => reject(new Error("文件读取失败"))
      });
    });
  },

  removeSource(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ sources: this.data.sources.filter((source) => source.id !== id) });
    this.saveState();
  },

  async analyzeProfile() {
    if (!this.hasReadableSource()) {
      wx.showModal({
        title: "缺少正文",
        content: "请先粘贴文章正文，或使用可公开读取的文章链接。抖音主页需要补充作品文案。",
        showCancel: false
      });
      return;
    }
    this.setData({ analyzeLoading: true, apiStatus: "AI 分析中", apiStatusMode: "busy" });
    try {
      const result = await api.request("/api/analyze", {
        sources: this.data.sources,
        rules: this.data.rules
      }, { timeout: 90000 });
      this.setData({
        profile: normalizeProfile(result.profile),
        currentStep: "profile",
        apiStatus: "AI 后台",
        apiStatusMode: "online",
        hotspotTopics: buildHotspotTopics(),
        hotspotStatus: "画像已更新，可以生成新的热点选题。"
      });
      this.refreshDerivedData();
      this.saveState();
    } catch (error) {
      wx.showToast({ title: error.message || "分析失败", icon: "none" });
      this.setData({ apiStatus: "分析失败", apiStatusMode: "offline" });
    } finally {
      this.setData({ analyzeLoading: false });
    }
  },

  hasReadableSource() {
    return this.data.sources.some((source) => source.body && !source.limited);
  },

  saveFocusNotes() {
    this.resetHotspotResults("关注画像已更新，可以重新生成热点选题。");
    this.refreshDerivedData();
    this.saveState();
    wx.showToast({ title: "已保存", icon: "none" });
  },

  saveRules() {
    const nextRules = splitRules(this.data.rulesInput);
    if (!nextRules.length) return;
    this.setData({
      rules: unique(this.data.rules.concat(nextRules)),
      rulesInput: ""
    });
    this.saveState();
  },

  async sendProfileMessage() {
    const message = this.data.profileMessage.trim();
    if (!message || this.data.profileChatLoading) return;
    const profileChat = this.data.profileChat.concat({ role: "user", text: message });
    this.setData({ profileMessage: "", profileChat, profileChatLoading: true, apiStatus: "AI 校准中", apiStatusMode: "busy" });
    try {
      const result = await api.request("/api/refine-profile", {
        profile: this.data.profile,
        message,
        rules: this.data.rules
      }, { timeout: 90000 });
      this.setData({
        profile: normalizeProfile(result.profile),
        rules: result.rules || this.data.rules,
        profileChat: this.data.profileChat.concat({ role: "ai", text: result.reply || "已按你的反馈校准。" }),
        apiStatus: "AI 后台",
        apiStatusMode: "online",
        hotspotTopics: buildHotspotTopics(),
        hotspotStatus: "画像已校准，可以重新生成热点选题。"
      });
      this.refreshDerivedData();
      this.saveState();
    } catch (error) {
      const nextRules = unique(this.data.rules.concat(splitRules(message)));
      this.setData({
        rules: nextRules,
        profileChat: this.data.profileChat.concat({ role: "ai", text: nextRules.length > this.data.rules.length ? "模型校准失败，但已把这句话保存为额外规则。" : "模型校准失败，请稍后重试。" }),
        apiStatus: "校准失败",
        apiStatusMode: "offline"
      });
      this.saveState();
    } finally {
      this.setData({ profileChatLoading: false });
    }
  },

  confirmProfile() {
    if (!this.data.profile.confidence) {
      wx.showToast({ title: "请先读稿", icon: "none" });
      return;
    }
    this.setData({ currentStep: "workbench" });
    this.refreshDerivedData();
    this.saveState();
  },

  setWorkbenchTab(event) {
    this.setData({ workbenchTab: event.currentTarget.dataset.tab });
    this.saveState();
  },

  researchTopic(event) {
    const title = event.currentTarget.dataset.title;
    this.setData({ selectedTopic: title, researchInput: title, workbenchTab: "research" });
    this.runTopicResearch();
  },

  useTopic(event) {
    const title = event.currentTarget.dataset.title;
    const angle = event.currentTarget.dataset.angle || "";
    this.setData({
      selectedTopic: title,
      taskInput: `围绕「${title}」写一篇内容。要求：有具体切口，不要泛泛而谈，最后输出适合我风格的版本。${angle ? `建议切口：${angle}` : ""}`,
      workbenchTab: "produce"
    });
    this.saveState();
  },

  onHotspotInput(event) {
    this.setData({ hotspotKeywordInput: event.detail.value });
  },

  async generateHotspotTopics() {
    const keywords = String(this.data.hotspotKeywordInput || "").trim();
    if (this.data.hotspotLoading) return;
    if (!this.hasHotspotSignal(keywords)) {
      this.setData({
        hotspotTopics: buildHotspotTopics(),
        hotspotStatus: "请先确认风格画像，或输入关注话题/关键词。"
      });
      return;
    }
    this.setData({
      hotspotLoading: true,
      hotspotTopics: buildHotspotTopics(),
      hotspotStatus: "正在读取 TopHub 和公开搜索...",
      apiStatus: "读取热点",
      apiStatusMode: "busy"
    });
    try {
      const result = await api.request("/api/hotspot-topics", {
        profile: this.data.profile,
        focusProfile: this.getFocusContext(),
        rules: this.data.rules,
        keywords
      }, { timeout: 90000 });
      const topics = (result.topics || []).map(formatHotspotTopicForMini);
      const sourceCount = result.sourceCount || {};
      this.setData({
        hotspotTopics: topics.length ? topics : buildHotspotTopics(),
        hotspotStatus: topics.length
          ? `已生成 Top${topics.length}。来源：TopHub ${sourceCount.topHub || 0} 条 / 搜索 ${sourceCount.search || 0} 条。`
          : (result.message || "没有读取到可核验热点，暂不生成选题。"),
        apiStatus: "AI 后台",
        apiStatusMode: "online"
      });
    } catch (error) {
      this.setData({
        hotspotTopics: buildHotspotTopics(),
        hotspotStatus: error.message || "热点选题生成失败。",
        apiStatus: "热点失败",
        apiStatusMode: "offline"
      });
    } finally {
      this.setData({ hotspotLoading: false });
    }
  },

  hasHotspotSignal(keywords) {
    const focus = this.getFocusContext();
    return Boolean(keywords || focus.notes || focus.domains.length || focus.topics.length);
  },

  resetHotspotResults(status) {
    this.setData({
      hotspotTopics: buildHotspotTopics(),
      hotspotStatus: status || "未生成前只展示流程，不输出默认选题。"
    });
  },

  runTopicResearch() {
    const topic = (this.data.researchInput || this.data.selectedTopic || this.getFocusContext().topics[0] || "").trim();
    if (!topic) {
      this.setData({ researchBlocks: [] });
      wx.showToast({ title: "先输入具体话题", icon: "none" });
      return;
    }
    this.setData({
      selectedTopic: topic,
      researchInput: topic,
      researchBlocks: buildResearchBlocks(topic)
    });
    this.saveState();
  },

  setContentType(event) {
    this.setData({ contentType: event.currentTarget.dataset.type });
    this.saveState();
  },

  async generateDraft() {
    const task = this.data.taskInput.trim();
    if (!task || this.data.generateLoading) return;
    if (!this.data.profile.confidence) {
      wx.showToast({ title: "请先确认画像", icon: "none" });
      return;
    }
    this.setData({
      generateLoading: true,
      apiStatus: "AI 工作流",
      apiStatusMode: "busy",
      initialDraft: "",
      evaluation: "",
      draft: "",
      finalized: false,
      thinking: "",
      draftStatus: "生成中"
    });
    try {
      this.resetStreamBuffer();
      await api.stream("/api/workflow-stream", {
        type: this.data.contentType,
        task,
        profile: this.data.profile,
        focusProfile: this.getFocusContext(),
        rules: this.data.rules
      }, {
        onEvent: (eventName, payload) => this.handleWorkflowEvent(eventName, payload),
        onError: () => {}
      });
      this.flushStreamBuffer();
      this.setData({
        deliverChat: [{ role: "ai", text: "优化稿已生成。可以继续说要改哪里，确认时说“好的”。" }],
        draftStatus: "已生成",
        apiStatus: "AI 后台",
        apiStatusMode: "online"
      });
      this.saveState();
    } catch (error) {
      wx.showToast({ title: error.message || "生成失败", icon: "none" });
      this.setData({ draftStatus: "生成失败", apiStatus: "生成失败", apiStatusMode: "offline" });
    } finally {
      this.setData({ generateLoading: false });
    }
  },

  handleWorkflowEvent(eventName, payload) {
    const text = payload.text || "";
    if (!text && eventName !== "done") return;
    if (eventName === "thinking") this.appendStreamText("thinking", text);
    if (eventName === "draftContent") this.appendStreamText("initialDraft", text);
    if (eventName === "evaluationContent") this.appendStreamText("evaluation", text);
    if (eventName === "finalContent") this.appendStreamText("draft", text);
    if (eventName === "done") this.setData({ draftStatus: "已生成" });
  },

  resetStreamBuffer() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.streamBuffer = {
      thinking: "",
      initialDraft: "",
      evaluation: "",
      draft: ""
    };
  },

  appendStreamText(field, text) {
    if (!text) return;
    if (!this.streamBuffer) this.resetStreamBuffer();
    this.streamBuffer[field] = (this.streamBuffer[field] || "") + text;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushStreamBuffer(), 120);
    }
  },

  flushStreamBuffer() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.streamBuffer) return;
    const next = {};
    ["thinking", "initialDraft", "evaluation", "draft"].forEach((field) => {
      const text = this.streamBuffer[field];
      if (!text) return;
      let value = `${this.data[field] || ""}${text}`;
      if (field === "thinking" && value.length > 8000) value = `...${value.slice(-8000)}`;
      next[field] = value;
      this.streamBuffer[field] = "";
    });
    if (Object.keys(next).length) this.setData(next);
  },

  async sendDeliverMessage() {
    const message = this.data.deliverMessage.trim();
    if (!message || !this.data.draft || this.data.deliverChatLoading) return;
    const originalDraft = this.data.draft;
    this.setData({
      deliverMessage: "",
      deliverChat: this.data.deliverChat.concat({ role: "user", text: message }),
      deliverChatLoading: true,
      apiStatus: isFinalApproval(message) ? "整理最终版" : "AI 改稿中",
      apiStatusMode: "busy",
      draft: "",
      finalized: false,
      thinking: "",
      draftStatus: "修改中"
    });
    try {
      this.resetStreamBuffer();
      await api.stream("/api/revise-stream", {
        draft: originalDraft,
        instruction: isFinalApproval(message) ? buildFinalInstruction(message) : message,
        profile: this.data.profile,
        rules: this.data.rules
      }, {
        onEvent: (eventName, payload) => {
          const text = payload.text || "";
          if (eventName === "thinking") this.appendStreamText("thinking", text);
          if (eventName === "content") this.appendStreamText("draft", text);
        }
      });
      this.flushStreamBuffer();
      const finalDraft = this.data.draft.trim() || originalDraft;
      const finalized = isFinalApproval(message);
      this.setData({
        draft: finalized ? cleanFinalDraft(finalDraft) : finalDraft,
        finalized,
        draftStatus: finalized ? "最终清洁版" : "已修改",
        deliverChat: this.data.deliverChat.concat({
          role: "ai",
          text: finalized ? "已生成最终清洁版，可复制或保存。" : "已按你的意见修改。"
        }),
        apiStatus: "AI 后台",
        apiStatusMode: "online"
      });
      this.saveState();
    } catch (error) {
      this.setData({
        draft: originalDraft,
        draftStatus: "修改失败",
        apiStatus: "修改失败",
        apiStatusMode: "offline"
      });
      wx.showToast({ title: error.message || "修改失败", icon: "none" });
    } finally {
      this.setData({ deliverChatLoading: false });
    }
  },

  copySearchQuery(event) {
    const query = event.currentTarget.dataset.query;
    wx.setClipboardData({
      data: query,
      success: () => wx.showToast({ title: "检索词已复制", icon: "none" })
    });
  },

  copyDraft() {
    if (!this.data.draft) return;
    wx.setClipboardData({
      data: this.data.draft,
      success: () => wx.showToast({ title: "已复制", icon: "none" })
    });
  },

  saveDraftFile() {
    if (!this.data.draft) return;
    const fs = wx.getFileSystemManager();
    const path = `${wx.env.USER_DATA_PATH}/content-simulator-${Date.now()}.txt`;
    fs.writeFile({
      filePath: path,
      data: this.data.draft,
      encoding: "utf8",
      success: () => wx.openDocument({ filePath: path, showMenu: true }),
      fail: () => wx.showToast({ title: "保存失败", icon: "none" })
    });
  },

  getFocusContext() {
    const profile = this.data.profile || DEFAULT_PROFILE;
    const domains = (profile.domains || []).slice(0, 3).map((item) => item.name).filter(Boolean);
    const topics = (profile.keywords || []).slice(0, 6).map((item) => item.word).filter(Boolean);
    const sourceText = this.data.sources.map((source) => `${source.title} ${source.body || ""}`).join(" ");
    const platforms = [];
    if (/公众号|微信/.test(sourceText)) platforms.push("公众号");
    if (/小红书/.test(sourceText)) platforms.push("小红书");
    if (/口播|短视频|抖音/.test(sourceText)) platforms.push("口播/短视频");
    return {
      domains,
      topics,
      platforms,
      notes: this.data.focusNotes || ""
    };
  },

  refreshDerivedData() {
    const profile = normalizeProfile(this.data.profile);
    const focus = this.getFocusContext();
    this.setData({
      profile,
      toneItems: Object.keys(profile.tones || {}).map((name) => ({ name, value: profile.tones[name] || 0 })),
      keywordTags: (profile.keywords || []).slice(0, 12).map((item) => item.word),
      focusTags: [
        ...focus.domains.map((item) => `领域：${item}`),
        ...focus.topics.map((item) => `话题：${item}`),
        ...focus.platforms.map((item) => `平台：${item}`)
      ].slice(0, 12),
      relatedInfo: buildRelatedInfo(focus),
      hotspotTopics: buildHotspotTopics(),
      researchBlocks: this.data.researchBlocks,
      draftStatus: this.data.finalized ? "最终清洁版" : this.data.draft ? "已生成" : "等待生成"
    });
  }
});

function normalizeProfile(profile = {}) {
  return {
    confidence: profile.confidence || "",
    tones: profile.tones || {},
    domains: profile.domains || [],
    keywords: profile.keywords || [],
    contentFeatures: profile.contentFeatures || [],
    textFeatures: profile.textFeatures || [],
    speechPatterns: profile.speechPatterns || [],
    trafficFeatures: profile.trafficFeatures || []
  };
}

function buildRelatedInfo(focus) {
  const topic = focus.topics[0] || focus.domains[0] || focus.notes || "";
  const domain = focus.domains[0] || focus.notes || "";
  if (!topic && !domain) return [];
  return [
    {
      source: "公开新闻检索",
      title: `${topic} 相关新闻`,
      body: `复制检索词，查看近期新闻、公共讨论和背景信息。`,
      query: `${topic} 新闻`
    },
    {
      source: "领域动态",
      title: `${domain || topic} 行业动态`,
      body: "补充行业变化、案例和趋势材料。",
      query: `${domain || topic} 行业动态`
    },
    {
      source: "热榜入口",
      title: "今日热点与平台讨论",
      body: "复制关键词后在浏览器或平台搜索。",
      query: "今日热点 平台热榜"
    }
  ];
}

function buildHotspotTopics() {
  return [
    {
      title: "1. 先确认用户输入",
      body: "读取用户旧稿、关注画像、平台方向、目标读者和本次任务；信息不足时停留等待，不输出默认选题。",
      framework: true
    },
    {
      title: "2. 双渠道收集热点",
      body: "同时读取 TopHub 和公开搜索，两个渠道平级处理；保留来源、时间、热度或可核验依据。",
      framework: true
    },
    {
      title: "3. 结合用户画像筛选",
      body: "按领域契合、平台适配、受众相关性、传播价值、风险程度过滤，只留下适合该用户的真实选题。",
      framework: true
    },
    {
      title: "4. 输出选题池",
      body: "每个选题应包含话题标题、来源、热度/依据、推荐切口、适配理由和风险提示。",
      framework: true
    }
  ];
}

function formatHotspotTopicForMini(topic = {}) {
  const scores = topic.scores || {};
  return {
    ...topic,
    title: topic.title || "",
    body: [
      topic.sourceSummary,
      topic.suggestedAngle ? `切口：${topic.suggestedAngle}` : "",
      topic.fitReason ? `适配：${topic.fitReason}` : "",
      topic.riskNote ? `边界：${topic.riskNote}` : ""
    ].filter(Boolean).join("\n"),
    scoreText: `总分 ${formatScore(scores.total)} / 新闻性 ${formatScore(scores.newsworthiness)} / 契合 ${formatScore(scores.userFit)}`,
    firstUrl: (topic.referenceUrls || [])[0] || "",
    framework: false
  };
}

function buildResearchBlocks(topic) {
  const current = topic || "";
  if (!current) return [];
  return [
    {
      title: "谁做过了",
      body: `同类内容通常会围绕「${current}」的事实、经验总结和情绪共鸣来写。`
    },
    {
      title: "为什么容易火",
      body: "容易火的内容往往有明确冲突、具体人物、强场景和可转述观点。"
    },
    {
      title: "还缺什么角度",
      body: "可以找更小的人群、更真实的细节、更长期的问题。"
    },
    {
      title: "建议切入口",
      body: "从一个具体人、一件具体事、一个被忽略的变化切入。"
    }
  ];
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function splitRules(text) {
  return String(text || "")
    .split(/[;\n；。]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function unique(items) {
  return Array.from(new Set(items));
}

function isFinalApproval(message) {
  const cleaned = String(message || "").toLowerCase().replace(/[，。！？、,.!?\s]/g, "");
  return ["好", "好的", "可以", "可以了", "行", "行了", "就这样", "确认", "确认了", "定稿", "定了", "没问题", "完成", "通过", "满意", "ok", "okay", "好的就这样", "可以定稿"].includes(cleaned);
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

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExtension(name) {
  const parts = String(name || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}
