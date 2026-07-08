const DEFAULT_API_BASE = "https://content-simulator.onrender.com";

function getApiBase() {
  const app = getApp();
  const saved = wx.getStorageSync("contentSimulatorApiBase");
  return String(saved || app.globalData.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
}

function setApiBase(value) {
  const apiBase = String(value || "").trim().replace(/\/$/, "");
  wx.setStorageSync("contentSimulatorApiBase", apiBase);
  getApp().globalData.apiBase = apiBase || DEFAULT_API_BASE;
  return getApiBase();
}

function request(path, data = {}, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBase()}${path}`,
      method: options.method || "POST",
      data,
      timeout: options.timeout || 60000,
      header: {
        "content-type": "application/json"
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(body.error || `请求失败：${res.statusCode}`));
          return;
        }
        resolve(body);
      },
      fail: (error) => reject(new Error(error.errMsg || "网络请求失败"))
    });
  });
}

function stream(path, data = {}, handlers = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let streamError = null;
    const decoder = makeUtf8Decoder();
    const task = wx.request({
      url: `${getApiBase()}${path}`,
      method: "POST",
      data,
      timeout: 180000,
      enableChunked: true,
      responseType: "arraybuffer",
      header: {
        "content-type": "application/json",
        "accept": "text/event-stream"
      },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`流式请求失败：${res.statusCode}`));
          return;
        }
        if (res.data) {
          buffer += decoder.decode(res.data);
          const parsed = parseSseBuffer(buffer, handlers);
          buffer = parsed.rest;
          streamError = streamError || parsed.error;
        }
        if (streamError) {
          reject(new Error(streamError));
          return;
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      },
      fail: (error) => {
        if (!settled) {
          settled = true;
          reject(new Error(error.errMsg || "流式请求失败"));
        }
      }
    });

    if (task && task.onChunkReceived) {
      task.onChunkReceived((event) => {
        buffer += decoder.decode(event.data);
        const parsed = parseSseBuffer(buffer, handlers);
        buffer = parsed.rest;
        streamError = streamError || parsed.error;
      });
    }
  });
}

function parseSseBuffer(buffer, handlers) {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() || "";
  let error = null;
  parts.forEach((part) => {
    const lines = part.split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];
    lines.forEach((line) => {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    });
    if (!dataLines.length) return;
    let payload = {};
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch (_error) {
      payload = { text: dataLines.join("\n") };
    }
    if (eventName === "error") {
      error = payload.error || "生成失败";
      handlers.onError && handlers.onError(error);
      return;
    }
    handlers.onEvent && handlers.onEvent(eventName, payload);
  });
  return { rest, error };
}

function makeUtf8Decoder() {
  if (typeof TextDecoder !== "undefined") {
    const decoder = new TextDecoder("utf-8");
    return {
      decode: (buffer) => decoder.decode(buffer, { stream: true })
    };
  }
  return {
    decode: (buffer) => decodeArrayBuffer(buffer)
  };
}

function decodeArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index++];
    if (byte < 0x80) {
      output += String.fromCharCode(byte);
    } else if (byte >= 0xc0 && byte < 0xe0) {
      const byte2 = bytes[index++] & 0x3f;
      output += String.fromCharCode(((byte & 0x1f) << 6) | byte2);
    } else if (byte >= 0xe0 && byte < 0xf0) {
      const byte2 = bytes[index++] & 0x3f;
      const byte3 = bytes[index++] & 0x3f;
      output += String.fromCharCode(((byte & 0x0f) << 12) | (byte2 << 6) | byte3);
    } else {
      const byte2 = bytes[index++] & 0x3f;
      const byte3 = bytes[index++] & 0x3f;
      const byte4 = bytes[index++] & 0x3f;
      const codePoint = ((byte & 0x07) << 18) | (byte2 << 12) | (byte3 << 6) | byte4;
      const offset = codePoint - 0x10000;
      output += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    }
  }
  return output;
}

module.exports = {
  getApiBase,
  setApiBase,
  request,
  stream
};
