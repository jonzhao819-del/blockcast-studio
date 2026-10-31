// The bundled Electron Chromium engine provides platform windows when no
// supported external browser is installed. Remote sites receive no preload or
// Node access. Debugging is in-process: no TCP debugging port is opened.
class EmbeddedClient {
  constructor(window, onEvent, onClose, timeoutMs = 15000) {
    this.window = window;
    this.debugger = window.webContents.debugger;
    this.timeoutMs = timeoutMs;
    this.pending = new Set();
    this.closed = false;
    this.onMessage = (_event, method, params) => onEvent?.(method, params || {});
    this.onDetach = () => { this.close(); onClose?.(); };
    this.ready = Promise.resolve().then(() => {
      if (!this.debugger.isAttached()) this.debugger.attach('1.3');
      this.debugger.on('message', this.onMessage);
      this.debugger.on('detach', this.onDetach);
    });
    this.ready.catch(() => {});
  }
  async call(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    await this.ready;
    if (this.closed || this.window.isDestroyed()) throw new Error('平台窗口已关闭，请重新打开');
    if (method === 'Page.bringToFront') {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show(); this.window.focus(); return {};
    }
    return new Promise((resolve, reject) => {
      const pending = { reject, timer: setTimeout(() => {
        this.pending.delete(pending); reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs) };
      this.pending.add(pending);
      Promise.resolve().then(() => this.debugger.sendCommand(method, params)).then(resolve, reject).finally(() => {
        clearTimeout(pending.timer); this.pending.delete(pending);
      });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending) { clearTimeout(pending.timer); pending.reject(new Error('平台窗口连接已关闭')); }
    this.pending.clear();
    this.debugger.removeListener('message', this.onMessage);
    this.debugger.removeListener('detach', this.onDetach);
    try { if (this.debugger.isAttached()) this.debugger.detach(); } catch {}
  }
}

function createEmbeddedBrowser({ BrowserWindow, session, profilePath, platformForUrl, onLoadError = () => {} }) {
  const windows = new Set();
  const initialUrls = new Map();
  const dedicatedSession = session.fromPath(profilePath);
  dedicatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  dedicatedSession.setPermissionCheckHandler(() => false);
  function safeUrl(url) { try { return new URL(url).protocol === 'https:'; } catch { return false; } }
  function track(window) {
    windows.add(window);
    window.setMenuBarVisibility(false);
    window.on('closed', () => { windows.delete(window); initialUrls.delete(window); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    for (const eventName of ['will-navigate', 'will-redirect']) {
      window.webContents.on(eventName, (event, url) => { if (!safeUrl(url)) event.preventDefault(); });
    }
    window.webContents.setWindowOpenHandler(({ url }) => safeUrl(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: preferences() } }
      : { action: 'deny' });
    window.webContents.on('did-create-window', popup => track(popup));
    return window;
  }
  function preferences() {
    return { session: dedicatedSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false };
  }
  return {
    open(urls) {
      for (const url of urls) {
        if (!safeUrl(url) || !platformForUrl(url)) throw new Error('不支持的平台地址');
        const id = platformForUrl(url);
        const existing = [...windows].find(win => !win.isDestroyed() && platformForUrl(win.webContents.getURL() || initialUrls.get(win)) === id);
        if (existing) { existing.show(); existing.focus(); continue; }
        const window = track(new BrowserWindow({ width: 1180, height: 860, minWidth: 800, minHeight: 600, title: '方块发布站 · 平台窗口', autoHideMenuBar: true, webPreferences: preferences() }));
        initialUrls.set(window, url);
        window.loadURL(url).catch(error => onLoadError(id, error));
      }
    },
    targets() {
      return [...windows].filter(win => !win.isDestroyed()).map(win => ({
        id: String(win.webContents.id), type: 'page', url: win.webContents.getURL(), webSocketDebuggerUrl: `embedded:${win.webContents.id}`
      }));
    },
    client(target, onEvent, onClose) {
      const window = [...windows].find(win => !win.isDestroyed() && String(win.webContents.id) === target.id);
      if (!window) throw new Error('平台窗口已关闭，请重新打开');
      return new EmbeddedClient(window, onEvent, onClose);
    },
    async closeAll() {
      await dedicatedSession.cookies.flushStore();
      for (const window of [...windows]) if (!window.isDestroyed()) window.destroy();
    },
    async clearData() { await dedicatedSession.clearStorageData(); await dedicatedSession.clearCache(); }
  };
}
module.exports = { EmbeddedClient, createEmbeddedBrowser };
