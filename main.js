const { app, BrowserWindow, ipcMain, dialog, shell, crashReporter, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { CDPClient } = require('./lib/cdp-client');
const { createUploadTracker } = require('./lib/upload-tracker');
const { assertPlatform, validateMedia, validatePayload, summarizeResults, trustedSender, selectTarget } = require('./lib/guards');
const { createLogger } = require('./lib/logger');
const { createSettings } = require('./lib/settings');
const { buildInspectExpression, buildProbeExpression, buildFillExpression, buildPublishExpression } = require('./lib/platform-adapters');
const { availableBrowsers, chooseBrowser, profileName } = require('./lib/browsers');
const { createEmbeddedBrowser } = require('./lib/embedded-browser');
const { randomUUID } = require('crypto');
const { uploadDecision, sameMedia } = require('./lib/upload-recovery');

let edgePort = null;
let activeBrowser;
let embeddedBrowser;
let switchingBrowser = false;
const PLATFORMS = {
  douyin: { name: '抖音', url: 'https://creator.douyin.com/creator-micro/content/upload', hosts: ['creator.douyin.com'], publishTexts: ['发布', '立即发布'] },
  bilibili: { name: 'bilibili', url: 'https://member.bilibili.com/platform/upload?page_from=creative_home_top_upload', hosts: ['member.bilibili.com', 'passport.bilibili.com'], publishTexts: ['立即投稿', '投稿', '发布'] },
  wechat: { name: '视频号', url: 'https://channels.weixin.qq.com/platform/post/create', hosts: ['channels.weixin.qq.com'], publishTexts: ['发表', '发布'] }
};

let controllerWindow;
let monitorTimer;
let edgeProfilePath;
let quitting = false;
let logger;
let settings;
let inspecting = false;
let connecting = new Map();
let openingEdge = null;
const operations = new Set();
const approvedMedia = new Map();
const submittedVideos = new Map();
const controllerUrl = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
const disconnectState = status => ({ connected: false, status, readyToPublish: false, formReady: false, fields: {}, options: {}, progress: null, bytesSent: null, bytesTotal: null, networkInFlight: 0, uploadStage: 'idle' });
const cdpClients = new Map();
const platformState = new Map(Object.keys(PLATFORMS).map(id => [id, {
  id, connected: false, status: '未在浏览器 中打开', url: '', progress: null,
  uploadStage: 'idle', fields: {}, options: {}, lastSeen: null
}]));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => {
  if (!controllerWindow) return;
  if (controllerWindow.isMinimized()) controllerWindow.restore();
  controllerWindow.show(); controllerWindow.focus();
});

function sendState() {
  if (controllerWindow && !controllerWindow.isDestroyed()) controllerWindow.webContents.send('platform:states', Object.fromEntries(platformState));
}
function updateState(id, patch) {
  platformState.set(id, { ...platformState.get(id), ...patch, lastSeen: Date.now() });
  sendState();
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, value) => {
    if (!trustedSender(event, controllerWindow?.webContents, controllerUrl)) throw new Error('拒绝非工作台页面调用');
    const id = typeof value === 'string' ? value : value?.id;
    if(switchingBrowser && (channel.startsWith('platform:') && channel!=='platform:list' || ['app:select-browser','app:reset-logins','media:attach'].includes(channel)))return {ok:false,error:'正在切换浏览器，请稍后再操作'};
    if (/^platform:(open|focus|reload|probe-options|fill|publish)$/.test(channel) || channel === 'media:attach') assertPlatform(id);
    const mutating = /^(platform:(reload|probe-options|fill|publish)|media:attach)$/.test(channel);
    if (mutating && operations.has(id)) return { ok: false, error: '该平台正在执行任务，请稍后再试' };
    if (mutating) operations.add(id);
    try { if(mutating && inspectingPlatforms.has(id))await inspectingPlatforms.get(id); return await handler(event, value); }
    finally { if (mutating) operations.delete(id); }
  });
}
function approveMedia(filePath, kind) {
  const file = validateMedia(filePath, kind);
  approvedMedia.set(file.path, file);
  settings?.set('selectedVideo', file);
  return file;
}
function requireApprovedMedia(filePath, kind) {
  const current = validateMedia(filePath, kind), selected = approvedMedia.get(current.path);
  if (!selected || selected.kind !== kind || selected.size !== current.size || selected.mtimeMs !== current.mtimeMs) throw new Error('素材未选择或选择后已改变，请重新选择');
  return current;
}

function browserInfo() {
  const available=availableBrowsers();
  return { current:activeBrowser || chooseBrowser(available,settings?.get('browserId')), available:available.map(({id,name})=>({id,name})) };
}
function configureBrowser(id) {
  activeBrowser=chooseBrowser(availableBrowsers(),id);
  edgeProfilePath=path.join(app.getPath('userData'),profileName(activeBrowser.id));
  if(activeBrowser.id==='builtin')embeddedBrowser=createEmbeddedBrowser({BrowserWindow,session,profilePath:edgeProfilePath,platformForUrl,
    onLoadError:(id,error)=>{logger?.error('browser.load_failed',{id,message:error.message});updateState(id,{status:'平台页面加载失败，请检查网络后重新打开',readyToPublish:false});}});
}

function readDevToolsPort() {
  try {
    const value = fs.readFileSync(path.join(edgeProfilePath, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch { return null; }
}

async function waitForEdgePort() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    edgePort = readDevToolsPort();
    if (edgePort) {
      try {
        const response = await fetch(`http://127.0.0.1:${edgePort}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return edgePort;
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('浏览器启动超时，请重试或选择内置浏览器');
}

async function listTargets() {
  if(activeBrowser?.id==='builtin')return embeddedBrowser.targets();
  edgePort = readDevToolsPort();
  if (!edgePort) return [];
  try {
    const response = await fetch(`http://127.0.0.1:${edgePort}/json/list`, { signal: AbortSignal.timeout(1200) });
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

function platformForUrl(url) {
  try { const parsed = new URL(url); if (parsed.protocol !== 'https:') return undefined; return Object.entries(PLATFORMS).find(([, p]) => p.hosts.includes(parsed.hostname))?.[0]; } catch { return undefined; }
}

function launchEdge(urls, newWindow = false) {
  const edge = activeBrowser?.executable;
  if (!edge) throw new Error('浏览器不可用，请切换到内置浏览器');
  const args = [
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${edgeProfilePath}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'
  ];
  if (newWindow) args.push('--new-window');
  args.push(...urls);
  const child = spawn(edge, args, { detached: true, stdio: 'ignore' });
  child.on('error', error => logger?.error('edge.launch_failed', { message: error.message }));
  child.unref();
  logger?.info('edge.launched', { tabs: urls.length, newWindow, pid: child.pid });
}

async function ensureEdge(urls, newWindow = false) {
  if(activeBrowser?.id==='builtin'){embeddedBrowser.open(urls);return;}
  const targets = await listTargets();
  if (!targets.length) {
    edgePort = null;
    try { fs.unlinkSync(path.join(edgeProfilePath, 'DevToolsActivePort')); } catch {}
    launchEdge(urls, newWindow);
    await waitForEdgePort();
    return;
  }
  if (urls.length) launchEdge(urls, newWindow);
}

async function openPlatform(id) {
  assertPlatform(id);
  const targets = await listTargets();
  const existing = selectTarget(targets, id, platformForUrl);
  if (existing?.webSocketDebuggerUrl) {
    const client = await getClient(id, existing);
    if (/\/creator-micro\/home\/?$/.test(new URL(existing.url).pathname)) await client.call('Page.navigate', { url: PLATFORMS[id].url });
    await client.call('Page.bringToFront'); return true;
  }
  await ensureEdge([PLATFORMS[id].url], !targets.some(t => t.type === 'page'));
  updateState(id, { status: '正在浏览器 标签页中打开' });
  return true;
}

async function openAllPlatforms() {
  if (openingEdge) return openingEdge;
  openingEdge = openAllPlatformsOnce();
  try { return await openingEdge; } finally { openingEdge = null; }
}
async function openAllPlatformsOnce() {
  const targets = await listTargets();
  const missing = Object.entries(PLATFORMS).filter(([id]) => !targets.some(t => t.type === 'page' && platformForUrl(t.url) === id)).map(([, p]) => p.url);
  if (missing.length) await ensureEdge(missing, !targets.some(t => t.type === 'page'));
  else {
    const first = targets.find(t => t.type === 'page' && platformForUrl(t.url));
    if (first) { const id = platformForUrl(first.url); const client = await getClient(id, first); await client.call('Page.bringToFront'); }
  }
  for (const id of Object.keys(PLATFORMS)) updateState(id, { status: '正在浏览器 中连接真实投稿页' });
  return true;
}

function networkEventHandler(id) { return createUploadTracker(patch => updateState(id, patch)); }

const UPLOAD_HOOK_SOURCE = `(() => {
  if (window.__blockcastUploadHookInstalled) return;
  Object.defineProperty(window, '__blockcastUploadHookInstalled', { value: true });
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try { this.__blockcastRequestUrl = new URL(url, location.href).origin + new URL(url, location.href).pathname; } catch { this.__blockcastRequestUrl = ''; }
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const binary = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || (body instanceof FormData && [...body.values()].some(value => value instanceof Blob));
    if (binary && this.upload && typeof window.__blockcastUploadProgress === 'function') {
      this.upload.addEventListener('progress', event => {
        if (!event.lengthComputable || !event.total) return;
        window.__blockcastUploadProgress(JSON.stringify({ loaded: event.loaded, total: event.total, binary: true }));
      });
    }
    return originalSend.call(this, body);
  };
})()`;

async function getClient(id, target) {
  if (connecting.has(id)) await connecting.get(id).catch(() => {});
  const cached = cdpClients.get(id);
  if (cached?.targetId === target.id) return cached.client;
  const connection = connectClient(id, target);
  connecting.set(id, connection);
  try { return await connection; } finally { if (connecting.get(id) === connection) connecting.delete(id); }
}
async function connectClient(id, target) {
  const cached = cdpClients.get(id);
  cdpClients.delete(id);
  cached?.client.close();
  const onClose = () => {
    if (cdpClients.get(id)?.client === client) { cdpClients.delete(id); updateState(id, disconnectState('平台窗口已关闭')); }
  };
  const client = activeBrowser?.id==='builtin' ? embeddedBrowser.client(target,networkEventHandler(id),onClose) : new CDPClient(target.webSocketDebuggerUrl,networkEventHandler(id),onClose);
  try {
  await client.ready;
  await client.call('Network.enable'); await client.call('Page.enable'); await client.call('DOM.enable'); await client.call('Runtime.enable');
  await client.call('Runtime.addBinding', { name: '__blockcastUploadProgress' });
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: UPLOAD_HOOK_SOURCE });
  // Polling must not depend on executing script in a loading/background tab.
  client.call('Runtime.evaluate', { expression: UPLOAD_HOOK_SOURCE }, { timeoutMs: 5000 }).catch(() => {});
  cdpClients.set(id, { targetId: target.id, client });
  return client;
  } catch (error) { client.close(); throw error; }
}

function dropClient(id) {
  const entry=cdpClients.get(id);cdpClients.delete(id);entry?.client.close();
}
const inspectingPlatforms=new Map();
function inspectPlatform(id, targets) {
  if(inspectingPlatforms.has(id))return inspectingPlatforms.get(id);
  const pending=inspectPlatformOnce(id,targets).finally(()=>inspectingPlatforms.delete(id));
  inspectingPlatforms.set(id,pending);return pending;
}
async function inspectPlatformOnce(id, targets) {
  const target=selectTarget(targets,id,platformForUrl);
  if(!target){dropClient(id);updateState(id,disconnectState('未找到专用浏览器 标签页，请点击在浏览器 打开'));return false;}
  try {
    const client=await getClient(id,target);
    const result=await client.call('Runtime.evaluate',{expression:buildInspectExpression(id),returnByValue:true,timeout:5000},{timeoutMs:6500});
    const snapshot=result.result?.value;
    if(!snapshot||result.exceptionDetails)throw new Error('页面正在加载或暂时无法读取');
    delete snapshot.fingerprint;
    const submitted=submittedVideos.get(id);
    if(submitted && snapshot.uploadToken===submitted.token && snapshot.videoIdentity && !submitted.videoIdentity){
      submitted.videoIdentity=snapshot.videoIdentity;persistSubmissions();
    }
    delete snapshot.videoIdentity;delete snapshot.uploadToken;
    if(snapshot.loginRequired||platformState.get(id).pathname!==snapshot.pathname)updateState(id,{options:{},readyToPublish:false});
    snapshot.options={...(platformState.get(id).options||{}),...(snapshot.options||{})};
    const current=platformState.get(id);
    if((current.networkInFlight||0)>0){
      Object.assign(snapshot,{uploadStage:current.uploadStage,status:current.status,readyToPublish:false,bytesSent:current.bytesSent,bytesTotal:current.bytesTotal,progressSource:current.progressSource,networkInFlight:current.networkInFlight});
    }
    updateState(id,{connected:true,...snapshot,url:target.url});return true;
  }catch(error){
    logger?.error('platform.inspect_failed',{id,message:error.message});
    dropClient(id);
    updateState(id,disconnectState('页面读取暂时超时或中断；登录状态未清除。可切换到该平台后重新连接'));
    return false;
  }
}
async function inspectTargets() {
  if(inspecting||quitting||switchingBrowser)return;inspecting=true;
  try{const targets=await listTargets();await Promise.all(Object.keys(PLATFORMS).filter(id=>!operations.has(id)).map(id=>inspectPlatform(id,targets)));}
  finally{inspecting=false;}
}
function persistSubmissions(){settings?.set('submittedVideos',Object.fromEntries(submittedVideos));}

async function assertCreatorPage(id, client) {
  const result = await client.call('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  const url = result.result?.value;
  if (platformForUrl(url) !== id || new URL(url).hostname === 'passport.bilibili.com') throw new Error('当前标签页不属于该平台创作中心，请重新打开投稿页');
}

async function attachFileByCDP(id, filePath, kind) {
  const entry = cdpClients.get(id); if (!entry) throw new Error('请先在浏览器 中打开平台投稿页');
  const client = entry.client;
  await assertCreatorPage(id, client);
  if (id === 'bilibili' && kind === 'video') {
    const expression = `(() => {const roots=[document];for(let i=0;i<roots.length&&i<30;i++){for(const e of roots[i].querySelectorAll('*')){if(e.shadowRoot&&!roots.includes(e.shadowRoot))roots.push(e.shadowRoot);if(e.tagName==='IFRAME'){try{if(e.contentDocument&&!roots.includes(e.contentDocument))roots.push(e.contentDocument)}catch{}}}}const all=s=>[...new Set(roots.flatMap(root=>[...root.querySelectorAll(s)]))];const inputs=all('input[type=file]').filter(input=>/video|mp4|mov|mkv|flv|avi/i.test(input.accept||'')&&!/image|txt/i.test(input.accept||''));const input=inputs.sort((a,b)=>(b.name?1:0)-(a.name?1:0))[0];if(!input)return null;let node=input;for(let i=0;i<12&&node;i++){const r=node.getBoundingClientRect?.();if(r&&r.width>180&&r.height>80){let left=r.left,top=r.top,w=node.ownerDocument?.defaultView;while(w&&w.frameElement){const fr=w.frameElement.getBoundingClientRect();left+=fr.left;top+=fr.top;w=w.frameElement.ownerDocument?.defaultView}return{x:left+r.width/2,y:top+r.height/2}}const root=node.getRootNode?.();node=node.parentElement||(root&&root.host)||null}return{x:innerWidth/2,y:innerHeight/2}})()`;
    const located = await client.call('Runtime.evaluate', { expression, returnByValue: true });
    const point = located.result?.value;
    if (!point) return false;
    const data = { items: [], files: [filePath], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await client.call('Input.dispatchDragEvent', { type, x: point.x, y: point.y, data });
    return true;
  }
  const { nodes } = await client.call('DOM.getFlattenedDocument', { depth: -1, pierce: true });
  const candidates = nodes.filter(node => node.nodeName === 'INPUT').map(node => {
    const attrs = Object.fromEntries(Array.from({ length: Math.floor((node.attributes || []).length / 2) }, (_, index) => [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
    if (attrs.type !== 'file') return null;
    const accept = String(attrs.accept || '').toLowerCase(); let score = 0;
    { if (/video|mp4|mov|mkv|flv|avi/.test(accept)) score += 10; if (/image|jpg|jpeg|png|webp|txt/.test(accept)) score -= 10; }
    if (attrs.name) score += 1;
    return { node, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!candidates[0] || candidates[0].score <= 0) return false;
  if (candidates[1]?.score === candidates[0].score) throw new Error('存在多个同类素材控件，无法安全确定目标，请在真实平台页操作');
  const backendNodeId = candidates[0].node.backendNodeId;
  await client.call('DOM.setFileInputFiles', { backendNodeId, files: [filePath] });
  const resolved = await client.call('DOM.resolveNode', { backendNodeId });
  if (resolved.object?.objectId) {
    // CDP already dispatches native input/change events. Re-dispatching starts
    // duplicate uploads on some platform components.
    await client.call('Runtime.callFunctionOn', { objectId: resolved.object.objectId, functionDeclaration: `function(){return this.files?.length||0}`, returnByValue: true });
    await client.call('Runtime.releaseObject', { objectId: resolved.object.objectId }).catch(() => {});
  }
  return true;
}

function richEditorExpression(id, action, value = '') {
  return `(() => {
    const platform=${JSON.stringify(id)},action=${JSON.stringify(action)},value=${JSON.stringify(value)};
    const clean=v=>String(v||'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\\s+/g,' ').trim();
    const visible=e=>!!(e&&(e.offsetWidth||e.offsetHeight||e.getClientRects().length));
    const roots=[document];for(let i=0;i<roots.length&&i<40;i++){for(const e of roots[i].querySelectorAll('*')){if(e.shadowRoot&&!roots.includes(e.shadowRoot))roots.push(e.shadowRoot);if(e.tagName==='IFRAME'){try{if(e.contentDocument&&!roots.includes(e.contentDocument))roots.push(e.contentDocument)}catch{}}}}
    const all=s=>[...new Set(roots.flatMap(root=>[...root.querySelectorAll(s)]))];
    const text=e=>clean(e?.innerText||e?.textContent);
    const editor=platform==='douyin'?all('.zone-container[contenteditable]').find(visible):all('.post-desc-box [contenteditable],.input-editor[contenteditable]').find(visible);
    if(!editor)return{ok:false,error:'未找到真实描述编辑器'};
    if(action==='focus'){editor.focus();return{ok:true}}
    if(action==='topic-button'){
      const button=platform==='douyin'?all('div,span,button').filter(e=>visible(e)&&text(e)==='#添加话题').sort((a,b)=>a.childElementCount-b.childElementCount)[0]:all('.finder-tag-wrap.btn').find(e=>visible(e)&&text(e)==='#话题');
      if(!button)return{ok:false,error:'未找到平台话题按钮'};button.click();return{ok:true};
    }
    if(action==='choose-topic'){
      if(platform==='wechat')return{ok:!!all('.hl.topic').find(e=>visible(e)&&text(e).replace(/^#/,'')===value)};
      const matches=all('.tag-dVUDkJ').filter(visible).filter(e=>text(e.querySelector('.tag-hash-view-name-DwMEe8')||e)===value);
      if(!matches.length)return{ok:false,error:'平台实时候选中没有该话题'};matches[0].click();return{ok:true};
    }
    if(action==='verify-description')return{ok:text(editor)===clean(value),textLength:text(editor).length};
    if(action==='verify-topic'){
      if(platform==='wechat')return{ok:!!all('.hl.topic').find(e=>text(e).replace(/^#/,'')===value)};
      return{ok:[...editor.querySelectorAll('[data-mention="#"]')].some(e=>text(e).replace(/^#/,'')===value)};
    }
    return{ok:false,error:'未知富文本操作'};
  })()`;
}

async function fillRichTextFieldsByCDP(id, payload) {
  if (!['douyin', 'wechat'].includes(id)) return [];
  const entry = cdpClients.get(id); if (!entry) return [];
  const client = entry.client, results = [];
  const evaluate = async (action, value = '') => {
    const response = await client.call('Runtime.evaluate', { expression: richEditorExpression(id, action, value), returnByValue: true });
    return response.result?.value || { ok: false, error: response.exceptionDetails?.text || '平台未返回结果' };
  };
  const focus = await evaluate('focus');
  if (!focus.ok) {
    if (payload.description) results.push({ field: 'description', ok: false, reason: focus.error });
    if ((payload.tags || []).length) results.push({ field: 'tags', ok: false, reason: focus.error });
    return results;
  }
  if (payload.description) {
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await client.call('Input.insertText', { text: payload.description });
    await new Promise(resolve => setTimeout(resolve, 180));
    const verified = await evaluate('verify-description', payload.description);
    results.push({ field: 'description', ok: !!verified.ok, reason: verified.ok ? undefined : '平台没有确认描述内容' });
  }
  const selected = [], failed = [];
  for (const rawTag of payload.tags || []) {
    const tag = String(rawTag || '').replace(/^#/, '').trim(); if (!tag) continue;
    if ((await evaluate('verify-topic', tag)).ok) { selected.push(tag); continue; }
    await evaluate('focus');
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 });
    const button = await evaluate('topic-button');
    if (!button.ok) { failed.push(tag); continue; }
    await new Promise(resolve => setTimeout(resolve, 120));
    if (id === 'douyin') {
      for (const character of tag) await client.call('Input.dispatchKeyEvent', { type: 'char', key: character, text: character, unmodifiedText: character });
      await new Promise(resolve => setTimeout(resolve, 200));
    } else {
      await client.call('Input.insertText', { text: tag });
      await new Promise(resolve => setTimeout(resolve, 220));
    }
    let chosen = { ok: false };
    for (let attempt = 0; attempt < 12 && !chosen.ok; attempt += 1) {
      chosen = await evaluate('choose-topic', tag);
      if (!chosen.ok) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (chosen.ok) {
      await new Promise(resolve => setTimeout(resolve, 180));
      const verified = await evaluate('verify-topic', tag);
      (verified.ok ? selected : failed).push(tag);
    } else failed.push(tag);
  }
  if ((payload.tags || []).length) results.push({ field: 'tags', ok: failed.length === 0, label: selected.join('、'), reason: failed.length ? `平台未确认：${failed.join('、')}` : undefined });
  return results;
}

function createController() {
  const savedBounds = settings?.get('windowBounds');
  controllerWindow = new BrowserWindow({ width: 1280, height: 820, ...(savedBounds || {}), minWidth: 980, minHeight: 680, backgroundColor: '#171b1c', title: '方块发布站', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  controllerWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  controllerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controllerWindow.webContents.on('will-navigate', event => event.preventDefault());
  controllerWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  controllerWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  controllerWindow.on('close', () => { if (!controllerWindow.isMinimized() && !controllerWindow.isMaximized()) settings?.set('windowBounds', controllerWindow.getBounds()); });
  controllerWindow.on('closed', () => { controllerWindow = null; if(!quitting)app.quit(); });
}

handle('platform:list', () => ({ configs: PLATFORMS, states: Object.fromEntries(platformState) }));
handle('platform:open', (_e, id) => openPlatform(id));
handle('platform:open-all', () => openAllPlatforms());
handle('platform:focus', async (_e, id) => {
  const targets = await listTargets(); const t = selectTarget(targets, id, platformForUrl);
  if (!t) return openPlatform(id); const client = await getClient(id, t); await client.call('Page.bringToFront'); return true;
});
handle('platform:reload', async (_e,id)=>{
  if(inspectingPlatforms.has(id))await inspectingPlatforms.get(id);
  dropClient(id);
  updateState(id,disconnectState('正在重新连接，保留平台草稿'));
  const ok=await inspectPlatform(id,await listTargets());
  return {ok,error:ok?undefined:platformState.get(id).status};
});
handle('platform:probe-options', async (_e, id) => {
  if (!PLATFORMS[id]) return { ok: false, error: '未知平台' };
  const entry = cdpClients.get(id);
  if (!entry) return { ok: false, error: '请先打开并登录该平台投稿页' };
  try {
    await assertCreatorPage(id, entry.client);
    const response = await entry.client.call('Runtime.evaluate', { expression: buildProbeExpression(id), returnByValue: true, awaitPromise: true });
    const options = response.result?.value;
    if (!options || typeof options !== 'object') return { ok: false, error: response.exceptionDetails?.text || '平台未返回候选项' };
    updateState(id, { options: { ...(platformState.get(id).options || {}), ...options }, status: '已读取真实平台候选，请在发布器中选择' });
    logger?.info('platform.options_probed', { id, groups: Object.fromEntries(Object.entries(options).map(([name, group]) => [name, group.values?.length || 0])) });
    return { ok: true, options };
  } catch (error) {
    logger?.error('platform.options_probe_failed', { id, message: error.message });
    return { ok: false, error: error.message };
  }
});
handle('platform:review-all', async () => { const targets=await listTargets(); const t=targets.find(x=>x.type==='page'&&platformForUrl(x.url)); if(t){const id=platformForUrl(t.url);const c=await getClient(id,t);await c.call('Page.bringToFront');} return true; });
handle('media:select', async (_e, kind) => {
  if (kind !== 'video') throw new Error('无效素材类型');
  const filters=[{name:'视频文件',extensions:['mp4','mov','mkv','webm']}];
  const result=await dialog.showOpenDialog(controllerWindow,{properties:['openFile'],filters}); if(result.canceled||!result.filePaths[0])return null;
  return approveMedia(result.filePaths[0], kind);
});
handle('media:from-path', (_e, { filePath, kind } = {}) => {
  try {
    if (kind !== 'video' || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
    const allowed = /\.(mp4|mov|mkv|webm)$/i;
    if (!allowed.test(filePath)) return null;
    return approveMedia(filePath, kind);
  } catch { return null; }
});
handle('media:restore',()=>{
  const saved=settings?.get('selectedVideo');if(!saved)return {file:null};
  try{
    const current=validateMedia(saved.path,'video');
    if(!sameMedia(saved,current))throw new Error('已保存的视频发生变化');
    approvedMedia.set(current.path,current);return {file:current};
  }catch{return {file:null,error:'上次视频已移动、删除或修改，请重新选择主视频；填写的信息已保留'};}
});
handle('media:attach',async(_e,{id,filePath,kind}={})=>{
  let dispatched=false;
  try{
    if(kind!=='video')throw new Error('封面请在各平台投稿页手动上传');
    const file=requireApprovedMedia(filePath,'video');
    if(inspectingPlatforms.has(id))await inspectingPlatforms.get(id);
    const target=selectTarget(await listTargets(),id,platformForUrl);
    if(!target)throw new Error('请先打开平台投稿页');
    const client=await getClient(id,target);
    await assertCreatorPage(id,client);
    const response=await client.call('Runtime.evaluate',{expression:buildInspectExpression(id),returnByValue:true,timeout:5000});
    const current=response.result?.value;
    if(!current||response.exceptionDetails)throw new Error('暂时无法读取当前素材状态，请重新连接后继续；已选视频保留');
    if(current.loginRequired)throw new Error('请在专用浏览器 的该平台页完成登录');
    const previous=submittedVideos.get(id);
    const decision=uploadDecision(previous,file,target.id,current);
    if(decision==='reused')return {ok:true,status:'reused',verified:true};
    if(decision==='confirm-existing'){
      const choice=await dialog.showMessageBox(controllerWindow,{type:'question',title:'继续平台已有视频',message:PLATFORMS[id].name+'投稿页已有视频或正在上传',detail:'无法自动确认是否为所选的 '+file.name+'。请在平台页核对。继续只填写当前视频，不会再次上传；若不是同一视频，请取消后在平台新建投稿。',buttons:['取消并检查','继续填写当前视频'],defaultId:0,cancelId:0,noLink:true});
      if(choice.response!==1)return {ok:false,error:'已保留所选视频。请核对平台已有视频后继续'};
      await assertCreatorPage(id,client);
      const check=await client.call('Runtime.evaluate',{expression:buildInspectExpression(id),returnByValue:true});
      const after=check.result?.value;
      if(!after||check.exceptionDetails||after.fingerprint!==current.fingerprint||after.videoIdentity!==current.videoIdentity||after.uploadToken!==current.uploadToken||after.loginRequired)throw new Error('确认期间页面已变化，请重新检查');
      const token=randomUUID();
      await client.call('Runtime.evaluate',{expression:'window.__blockcastUploadToken='+JSON.stringify(token)});
      submittedVideos.set(id,{...file,targetId:target.id,token,videoIdentity:current.videoIdentity});persistSubmissions();
      return {ok:true,status:'reused',verified:true};
    }
    if(decision==='confirm-retry'){
      const choice=await dialog.showMessageBox(controllerWindow,{type:'question',title:'核对上次视频提交结果',message:'上次提交未能确认，平台目前未检测到视频',detail:'请先检查 '+PLATFORMS[id].name+' 页面。只有确认平台没有收到视频、且未在上传时，才重新提交。无需重新导入文件。',buttons:['取消并检查','确认无视频，重新提交'],defaultId:0,cancelId:0,noLink:true});
      if(choice.response!==1)return {ok:false,error:'保留已选视频，等待核对上次提交结果'};
      await assertCreatorPage(id,client);
      const check=await client.call('Runtime.evaluate',{expression:buildInspectExpression(id),returnByValue:true});
      const after=check.result?.value;
      if(!after||check.exceptionDetails||after.hasVideo||['uploading','processing'].includes(after.uploadStage)||after.loginRequired)throw new Error('平台状态已变化，请重新核对后继续');
    }
    const token=randomUUID();
    await client.call('Runtime.evaluate',{expression:'window.__blockcastUploadToken='+JSON.stringify(token)});
    submittedVideos.set(id,{...file,targetId:target.id,token});persistSubmissions();
    updateState(id,{uploadStage:'uploading',status:'正在提交视频到真实上传控件',readyToPublish:false,progress:null,bytesSent:null,bytesTotal:null});
    dispatched=true;
    const ok=await attachFileByCDP(id,file.path,'video');
    if(!ok){submittedVideos.delete(id);persistSubmissions();throw new Error('未找到可靠的视频上传控件，请先在平台进入视频投稿页；已选视频已保留');}
    logger?.info('media.attach',{id,kind,ok});
    return {ok:true,status:'submitted',verified:false};
  }catch(error){
    updateState(id,{readyToPublish:false,status:error.message,...(dispatched?{uploadStage:'unknown'}:{})});
    return {ok:false,error:error.message};
  }
});
handle('platform:fill', async (_e, { id, payload } = {}) => {
  payload = validatePayload(id, payload);
  for (const field of ['partition', 'collection']) {
    const choice = payload[field]; if (!choice) continue;
    const options = platformState.get(id)?.options?.[field]?.values || [];
    if (!choice.id || options.filter(option => option.name === choice.name).length !== 1 || !options.some(option => String(option.id) === choice.id && option.name === choice.name)) return { ok: false, error: `${field} 候选已失效、重名或缺少真实 ID，请重新读取或到平台页选择` };
  }
  const entry = cdpClients.get(id);
  if (!entry) return { ok: false, error: '浏览器平台标签页未连接' };
  const expression = `(() => {
    const payload=${JSON.stringify(payload)};
    const clean=v=>String(v||'').replace(/\\s+/g,' ').trim();
    const visible=e=>!!(e&&(e.offsetWidth||e.offsetHeight||e.getClientRects().length));
    const roots=[document];for(let i=0;i<roots.length&&i<20;i++){for(const e of roots[i].querySelectorAll('*')){if(e.shadowRoot&&!roots.includes(e.shadowRoot))roots.push(e.shadowRoot);if(e.tagName==='IFRAME'){try{if(e.contentDocument&&!roots.includes(e.contentDocument))roots.push(e.contentDocument)}catch{}}}}
    const all=selector=>[...new Set(roots.flatMap(root=>[...root.querySelectorAll(selector)]))];
    const label=e=>clean(e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.getAttribute('name')||e.closest('label,[class*=form],[class*=item],[class*=field]')?.textContent).slice(0,120);
    const controls=all('input:not([type=password]):not([type=file]),textarea,[contenteditable=true],select').filter(visible);
    const results=[];
    const setText=(el,value)=>{if(!value)return false;if(el.isContentEditable){el.focus();el.textContent=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));return true}const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return true};
    const pick=(name,pattern,exclude,value)=>{const candidates=controls.filter(e=>e.tagName!=='SELECT'&&pattern.test(label(e))&&!(exclude&&exclude.test(label(e))));if(candidates.length===1){setText(candidates[0],value);results.push({field:name,ok:true,label:label(candidates[0])})}else results.push({field:name,ok:false,count:candidates.length,reason:candidates.length?'控件不唯一':'未找到控件'})};
    pick('title',/标题|title|作品名称/i,/搜索|话题|合集/,payload.title);
    pick('description',/简介|描述|description|作品介绍|视频介绍/i,/搜索|话题|合集/,payload.description);
    const selectByText=(name,pattern,wanted)=>{if(!wanted)return;const candidates=controls.filter(e=>e.tagName==='SELECT'&&pattern.test(label(e)));if(candidates.length!==1){results.push({field:name,ok:false,count:candidates.length,reason:'原生下拉控件不唯一'});return}const s=candidates[0];const option=[...s.options].find(o=>clean(o.textContent)===wanted||clean(o.textContent).includes(wanted));if(!option){results.push({field:name,ok:false,reason:'当前账号选项中没有匹配项'});return}s.value=option.value;s.dispatchEvent(new Event('change',{bubbles:true}));results.push({field:name,ok:true,label:clean(option.textContent),id:option.value})};
    selectByText('visibility',/可见|权限|visibility/i,payload.visibility);
    selectByText('partition',/分区|分类|category|partition/i,payload.partition);
    selectByText('collection',/合集|系列|collection|season/i,payload.collection);
    if(payload.scheduleAt){const dates=controls.filter(e=>e.tagName==='INPUT'&&['datetime-local','date'].includes(e.type));if(dates.length===1){setText(dates[0],payload.scheduleAt);results.push({field:'schedule',ok:true})}else results.push({field:'schedule',ok:false,count:dates.length,reason:'定时控件不唯一'})}
    if((payload.tags||[]).length)results.push({field:'tags',ok:false,reason:'必须选择平台实时返回的话题候选'});
    return {ok:results.some(r=>r.ok),results};
  })()`;
  const usesRichEditor = ['douyin', 'wechat'].includes(id);
  const basePayload = usesRichEditor ? { ...payload, description: '', tags: [] } : payload;
  const adapterExpression = buildFillExpression(id, basePayload);
  try {
    await assertCreatorPage(id, entry.client);
    const response = await entry.client.call('Runtime.evaluate', { expression: adapterExpression, returnByValue: true, awaitPromise: true });
    const result = response.result?.value || { ok: false, error: '平台未返回填写结果' };
    if (usesRichEditor) {
      const richResults = await fillRichTextFieldsByCDP(id, payload);
      result.results = [...(result.results || []).filter(item => !['description', 'tags'].includes(item.field)), ...richResults];
    }
    Object.assign(result, summarizeResults(result.results));
    logger.info('platform.fill', { id, successCount: result.results?.filter(item => item.ok).length || 0 });
    return result;
  } catch (error) {
    logger.error('platform.fill_failed', { id, message: error.message });
    return { ok: false, error: error.message };
  }
});
handle('platform:publish', async (_e,id)=>{
  const entry=cdpClients.get(id);if(!entry)return{ok:false,error:'浏览器平台标签页未连接'};
  await assertCreatorPage(id, entry.client);
  const inspect = async () => {
    const response = await entry.client.call('Runtime.evaluate', { expression: buildInspectExpression(id), returnByValue: true });
    return response.result?.value;
  };
  const before = await inspect();
  if (!before?.readyToPublish || platformState.get(id)?.networkInFlight > 0) return { ok: false, error: '平台仍在上传、处理或必填项未完成，拒绝发布' };
  const confirmation = await dialog.showMessageBox(controllerWindow, { type: 'warning', title: `最终发布到${PLATFORMS[id].name}`, message: `即将点击${PLATFORMS[id].name}真实投稿页的最终发布按钮`, detail: '请确认你已经在浏览器 中逐项核对视频、封面、标题、话题、分区、合集和定时设置。此操作会对外发布内容。', buttons: ['取消', '确认发布'], defaultId: 0, cancelId: 0, noLink: true });
  if (confirmation.response !== 1) return { ok: false, canceled: true, error: '用户取消发布' };
  await assertCreatorPage(id, entry.client);
  const after = await inspect();
  if (!after?.readyToPublish || before.fingerprint !== after.fingerprint || cdpClients.get(id) !== entry || platformState.get(id)?.networkInFlight > 0) return { ok: false, error: '确认期间平台页面或内容已变化，请重新复核' };
  const expression = buildPublishExpression(id, after.fingerprint);
  const r=await entry.client.call('Runtime.evaluate',{expression,returnByValue:true});const result=r.result?.value||{ok:false,error:'平台未返回执行结果'};logger?.info('publish.requested',{id,ok:result.ok});return result;
});

app.whenReady().then(()=>{
  if (!hasSingleInstanceLock) return;
  crashReporter.start({ uploadToServer: false, compress: false });
  logger=createLogger(app);settings=createSettings(app,logger);
  for(const id of Object.keys(PLATFORMS)){const record=settings.get('submittedVideos')?.[id];if(record)submittedVideos.set(id,record);}
  logger.info('app.ready',{version:app.getVersion(),platform:process.platform,arch:process.arch});
  configureBrowser(settings.get('browserId'));
  createController(); monitorTimer=setInterval(inspectTargets,2500); inspectTargets();
  if (process.argv.includes('--open-platforms')) openAllPlatforms().catch(error => logger.error('edge.open_all_failed', { message: error.message }));
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createController()});
});
process.on('uncaughtException', error => logger?.error('process.uncaught_exception', { message: error.message, stack: error.stack }));
process.on('unhandledRejection', reason => logger?.error('process.unhandled_rejection', { message: reason?.message || String(reason) }));
async function closeDedicatedEdge() {
  clearInterval(monitorTimer);
  if(activeBrowser?.id==='builtin'){for(const entry of cdpClients.values())entry.client.close();cdpClients.clear();await embeddedBrowser.closeAll();return;}
  try {
    if (!edgePort) edgePort = readDevToolsPort();
    if (edgePort) {
      const response = await fetch(`http://127.0.0.1:${edgePort}/json/version`, { signal: AbortSignal.timeout(800) });
      if (response.ok) {
        const version = await response.json();
        if (version.webSocketDebuggerUrl) {
          const browserClient = new CDPClient(version.webSocketDebuggerUrl);
          try { await browserClient.call('Browser.close'); } finally { browserClient.close(); }
        }
      }
    }
  } catch {}
  for (const entry of cdpClients.values()) entry.client.close();
  cdpClients.clear();
}
async function resetEdgeProfile() {
  const base = path.resolve(app.getPath('userData'));
  const profile = path.resolve(edgeProfilePath);
  if (!profile.startsWith(`${base}${path.sep}`)) throw new Error('拒绝清理非应用数据目录');
  const choice = await dialog.showMessageBox(controllerWindow, {
    type: 'warning', title: '清除三个平台登录状态',
    message: '这会退出发布器专用浏览器 中的抖音、bilibili 和视频号账号。',
    detail: '只清除当前发布浏览器的专用登录状态，不影响日常浏览器或其他发布浏览器。清除后需要重新扫码登录。',
    buttons: ['取消', '确认清除'], defaultId: 0, cancelId: 0, noLink: true
  });
  if (choice.response !== 1) return { ok: false, canceled: true };
  await closeDedicatedEdge();
  let cleared = false;
  if(activeBrowser?.id==='builtin'){await embeddedBrowser.clearData();cleared=true;}
  for (let attempt = 0; !cleared && attempt < 10; attempt += 1) {
    try { fs.rmSync(profile, { recursive: true, force: true }); cleared = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  monitorTimer = setInterval(inspectTargets, 2500);
  if (!cleared) return { ok: false, error: '专用浏览器尚未完全退出，请稍后再试' };
  edgePort = null;
  for (const id of Object.keys(PLATFORMS)) updateState(id, disconnectState('登录状态已清除'));
  logger.info('edge.profile_reset');
  return { ok: true };
}

handle('app:runtime-info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, browser:browserInfo(), logDirectory: logger?.directory }));
handle('app:select-browser',async(_e,id)=>{
  if(!availableBrowsers().some(browser=>browser.id===id))return {ok:false,error:'该浏览器不可用'};
  if(operations.size)return {ok:false,error:'请等待当前平台操作结束再切换浏览器'};
  if(id===activeBrowser.id)return {ok:true,browser:browserInfo()};
  switchingBrowser=true;
  try {
  if((await listTargets()).length){
    const answer=await dialog.showMessageBox(controllerWindow,{type:'question',title:'切换发布浏览器',message:'切换会关闭当前专用平台窗口，请先保存平台草稿。',detail:'各浏览器的专用登录状态分别保留。首次使用另一浏览器需要重新登录。',buttons:['取消','已保存，切换'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return {ok:false,canceled:true,browser:browserInfo()};
  }
  clearInterval(monitorTimer);
  await Promise.allSettled([...inspectingPlatforms.values()]);
  await closeDedicatedEdge();edgePort=null;
  configureBrowser(id);settings.set('browserId',id);
  submittedVideos.clear();persistSubmissions();
  for(const platform of Object.keys(PLATFORMS))updateState(platform,disconnectState('已切换浏览器，请打开平台并登录'));
  monitorTimer=setInterval(inspectTargets,2500);
  return {ok:true,browser:browserInfo()};
  } finally {switchingBrowser=false;}
});
handle('app:show-logs', () => logger?.file ? shell.showItemInFolder(logger.file) : false);
handle('app:reset-logins', () => resetEdgeProfile());
handle('app:export-diagnostics', async () => {
  const result = await dialog.showSaveDialog(controllerWindow, {
    title: '导出平台字段诊断',
    defaultPath: `blockcast-fields-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON 诊断文件', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const platforms = {};
  for (const [id, state] of platformState) {
    platforms[id] = {
      connected: state.connected,
      loginRequired: state.loginRequired,
      uploadStage: state.uploadStage,
      readyToPublish: state.readyToPublish,
      fields: state.fields,
      options: state.options
    };
  }
  const diagnostic = { schemaVersion: 1, appVersion: app.getVersion(), generatedAt: new Date().toISOString(), platforms };
  fs.writeFileSync(result.filePath, JSON.stringify(diagnostic, null, 2), { encoding: 'utf8', mode: 0o600 });
  logger.info('diagnostics.exported');
  return { ok: true, filePath: result.filePath };
});
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  closeDedicatedEdge().finally(() => app.quit());
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
