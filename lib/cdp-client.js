class CDPClient {
  constructor(url, onEvent, onClose, { WebSocketImpl = WebSocket, timeoutMs = 15000 } = {}) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1') throw new Error('拒绝连接非本机调试通道');
    this.ws = new WebSocketImpl(url);
    this.id = 0;
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      this.connectTimer = setTimeout(() => { reject(new Error('Edge 连接超时')); this.close(); }, timeoutMs);
      this.ws.onopen = () => { clearTimeout(this.connectTimer); resolve(); };
      this.ws.onerror = () => { reject(new Error('Edge 调试通道连接失败')); this.close(); };
    });
    this.ready.catch(() => {});
    this.ws.onmessage = event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(data.id);
      if (pending) {
        this.pending.delete(data.id); clearTimeout(pending.timer);
        data.error ? pending.reject(new Error(data.error.message)) : pending.resolve(data.result);
      } else if (data.method) { try { onEvent?.(data.method, data.params || {}); } catch {} }
    };
    this.ws.onclose = () => { this.cleanup(); onClose?.(); };
  }
  cleanup() {
    clearTimeout(this.connectTimer);
    const error = new Error('Edge 标签页连接已关闭');
    this.rejectReady(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  async call(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    await this.ready;
    if (this.ws.readyState !== 1) throw new Error('Edge 标签页连接已关闭');
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() { this.cleanup(); try { this.ws.close(); } catch {} }
}
module.exports = { CDPClient };
