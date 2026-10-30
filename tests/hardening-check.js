const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPlatform, validateMedia, validatePayload, summarizeResults, trustedSender, selectTarget } = require('../lib/guards');
const { CDPClient } = require('../lib/cdp-client');
const { createUploadTracker } = require('../lib/upload-tracker');
const { redact } = require('../lib/logger');
const { buildInspectExpression, buildProbeExpression, buildFillExpression, buildPublishExpression } = require('../lib/platform-adapters');
test('all generated browser programs compile before reaching a real page', () => {
  for (const id of ['douyin','bilibili','wechat']) {
    for(const expression of [buildInspectExpression(id),buildProbeExpression(id),buildFillExpression(id,{tags:[]}),buildPublishExpression(id,'fixture')]) assert.doesNotThrow(()=>new Function(expression));
  }
});

test('IPC only trusts the current controller main frame and exact local URL', () => {
  const mainFrame = { url: 'file:///controller.html' };
  const sender = { mainFrame, isDestroyed: () => false };
  assert(trustedSender({ sender, senderFrame: mainFrame }, sender, mainFrame.url));
  assert(!trustedSender({ sender, senderFrame: { url: mainFrame.url } }, sender, mainFrame.url));
  assert(!trustedSender({ sender: {}, senderFrame: mainFrame }, sender, mainFrame.url));
  assert(!trustedSender({ sender, senderFrame: mainFrame }, sender, 'https://attacker.invalid'));
});
test('prototype keys are not valid platform names', () => {
  for (const id of ['__proto__', 'constructor', null, {}, 'other']) assert.throws(() => assertPlatform(id));
});
test('media rejects empty files, wrong kinds and extensions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcast-guard-'));
  try {
    const video = path.join(root, 'video.mp4'); fs.writeFileSync(video, 'fixture');
    assert.equal(validateMedia(video, 'video').size, 7);
    assert.throws(() => validateMedia(video, 'cover'));
    assert.throws(() => validateMedia(video, '__proto__'));
    const empty = path.join(root, 'empty.mp4');fs.writeFileSync(empty, '');
    assert.throws(() => validateMedia(empty, 'video'));
    assert.throws(() => validateMedia(root, 'video'));
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('payload normalizes duplicate tags, rejects bad times and malformed choices', () => {
  const payload = { title: '标题', tags: ['#舞蹈', '舞蹈'] };
  assert.deepEqual(validatePayload('douyin', payload).tags, ['舞蹈']);
  assert.throws(() => validatePayload('douyin', { ...payload, scheduleAt: '2000-01-01T10:00' }));
  assert.throws(() => validatePayload('douyin', { ...payload, tags: '舞蹈' }));
  assert.throws(() => validatePayload('douyin', { ...payload, collection: { name: 'a', id: {} } }));
});
test('partial field failures never report complete success', () => {
  assert.equal(summarizeResults([{ ok: true }, { ok: false }]).ok, false);
  assert.equal(summarizeResults([{ ok: true }, { ok: false }]).partial, true);
  assert.equal(summarizeResults([]).ok, false);
  assert.equal(summarizeResults([{ ok: true }]).ok, true);
});
test('creator form is preferred over login helper tab', () => {
  const targets = ['https://passport.bilibili.com/login','https://member.bilibili.com/platform/upload'].map(url => ({ type:'page', url, webSocketDebuggerUrl:'ws://127.0.0.1:1' }));
  assert.equal(selectTarget(targets, 'bilibili', ()=>'bilibili').url, targets[1].url);
});
test('upload tracker ignores analytics; chunk bytes never become overall progress', () => {
  const patches = [], track = createUploadTracker(patch => patches.push(patch));
  track('Runtime.bindingCalled', { name:'__blockcastUploadProgress', payload:JSON.stringify({ loaded:20,total:100 }) });
  assert.equal(patches.length, 0);
  track('Runtime.bindingCalled', { name:'__blockcastUploadProgress', payload:JSON.stringify({ loaded:100,total:100,binary:true }) });
  assert.equal(patches.at(-1).progress, null);
  assert.equal(patches.at(-1).progressScope, 'request');
  for (const requestId of ['a','b'])track('Network.requestWillBeSent',{ requestId, request:{ method:'PUT',url:'https://upload.invalid/chunk/1' } });
  track('Network.loadingFinished',{requestId:'a'});
  assert.equal(patches.at(-1).uploadStage,'uploading');
  assert.equal(patches.at(-1).networkInFlight,1);
  track('Network.responseReceived',{requestId:'b',response:{status:500}});
  track('Network.loadingFinished',{requestId:'b'});
  assert.equal(patches.at(-1).uploadStage,'failed');
});
test('structured secrets and full cookie headers are redacted', () => {
  const result = redact({ access_token:'secret-A', cookie:'sid=secret-B; extra=secret-C', authorization:'Bearer secret-D' });
  for(const secret of ['secret-A','secret-B','secret-C','secret-D'])assert(!result.includes(secret));
  assert(!redact('Cookie: sid=secret-B; extra=secret-C').includes('secret-C'));
  assert.equal(redact(undefined),'');
});
class FakeSocket {
  constructor(){ this.readyState=0; FakeSocket.last=this; }
  open(){ this.readyState=1;this.onopen(); }
  send(){ if(this.failSend)throw new Error('send failed'); }
  close(){ this.readyState=3; this.onclose?.(); }
}
test('CDP closes pending requests and releases their timers', async () => {
  const client=new CDPClient('ws://127.0.0.1:1234/devtools/page/a',null,null,{WebSocketImpl:FakeSocket,timeoutMs:50});
  FakeSocket.last.open();
  const call=client.call('Page.enable');await Promise.resolve();
  client.close();await assert.rejects(call,/关闭/);assert.equal(client.pending.size,0);
});
test('CDP handshake and send failures are bounded', async () => {
  assert.throws(()=>new CDPClient('ws://example.com/socket'));
  const hanging=new CDPClient('ws://127.0.0.1:1',null,null,{WebSocketImpl:FakeSocket,timeoutMs:20});
  await assert.rejects(hanging.call('Page.enable'),/超时/);
  const client=new CDPClient('ws://127.0.0.1:1',null,null,{WebSocketImpl:FakeSocket,timeoutMs:50});
  FakeSocket.last.open();FakeSocket.last.failSend=true;
  await assert.rejects(client.call('Page.enable'),/send failed/);
  assert.equal(client.pending.size,0);client.close();
});
