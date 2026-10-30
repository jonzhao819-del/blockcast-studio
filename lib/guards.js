const fs = require('fs');
const path = require('path');

const PLATFORM_IDS = ['douyin', 'bilibili', 'wechat'];
function assertPlatform(id) {
  if (!PLATFORM_IDS.includes(id)) throw new Error('未知平台');
  return id;
}
function validateMedia(filePath, kind) {
  const extensions = { video: /\.(mp4|mov|mkv|webm)$/i, cover: /\.(jpe?g|png|webp)$/i };
  if (!Object.hasOwn(extensions, kind) || typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0') || !extensions[kind].test(filePath)) throw new Error('素材路径或文件格式无效');
  const resolved = fs.realpathSync(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size === 0) throw new Error('素材必须是非空文件');
  if (kind === 'cover' && stat.size > 30 * 1024 * 1024) throw new Error('封面超过 30 MB，请压缩后重试');
  return { path: resolved, name: path.basename(resolved), size: stat.size, kind, mtimeMs: stat.mtimeMs };
}
function validatePayload(id, value) {
  assertPlatform(id);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('发布信息格式无效');
  const text = (key, max) => {
    const v = value[key] ?? '';
    if (typeof v !== 'string' || v.length > max) throw new Error(`${key} 类型或长度无效（最多 ${max} 字符）`);
    return v.trim();
  };
  const choice = key => {
    const v = value[key];
    if (v == null || v === '') return null;
    if (typeof v !== 'object' || typeof v.name !== 'string' || v.name.length > 200 || typeof v.id !== 'string' || v.id.length > 160) throw new Error(`${key} 候选无效，请重新读取真实候选`);
    return { name: v.name, id: v.id };
  };
  if (!Array.isArray(value.tags) || value.tags.length > 30 || value.tags.some(v => typeof v !== 'string' || v.length > 100)) throw new Error('话题格式无效或过长');
  const result = { title: text('title', 200), description: text('description', 10000), visibility: text('visibility', 40), scheduleAt: text('scheduleAt', 30), tags: [...new Set(value.tags.map(v => v.replace(/^#+/, '').trim()).filter(Boolean))], partition: choice('partition'), collection: choice('collection') };
  if (result.scheduleAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(result.scheduleAt) || !Number.isFinite(Date.parse(result.scheduleAt)) || Date.parse(result.scheduleAt) <= Date.now())) throw new Error('定时发布必须选择有效的未来时间');
  return result;
}
function summarizeResults(results) {
  const items = Array.isArray(results) ? results : [];
  return { ok: items.length > 0 && items.every(item => item.ok === true), partial: items.some(item => item.ok === true) && items.some(item => item.ok !== true), results: items };
}
function trustedSender(event, contents, expectedUrl) {
  return !!contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame?.url === expectedUrl;
}
function selectTarget(targets, id, platformForUrl) {
  const candidates = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && platformForUrl(t.url) === id);
  // Login helper tabs must never win over an existing creator form.
  return candidates.sort((a, b) => Number(/upload|post\/create|publish/.test(b.url)) - Number(/upload|post\/create|publish/.test(a.url)))[0];
}
module.exports = { assertPlatform, validateMedia, validatePayload, summarizeResults, trustedSender, selectTarget };
