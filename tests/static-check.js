const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { redact } = require('../lib/logger');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const adapters = fs.readFileSync(path.join(root, 'lib', 'platform-adapters.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');

assert(main.includes('--remote-debugging-port=0'), 'Edge must use a random debugging port');
assert(main.includes('--remote-debugging-address=127.0.0.1'), 'Edge debugging must be loopback-only');
assert(!main.includes('EDGE_PORT ='), 'Fixed debugging ports are forbidden');
assert(main.includes('requestSingleInstanceLock'), 'Single-instance protection is required');
assert(main.includes("Browser.close"), 'Dedicated Edge must close with the app');
assert(main.includes('XMLHttpRequest.prototype.send') && main.includes('createUploadTracker'), 'Real XHR upload byte progress hook is required');
assert(main.includes("Input.dispatchDragEvent") && main.includes("id === 'bilibili'"), 'Bilibili must use its verified drag/drop upload path');
assert(main.includes('platform:probe-options') && preload.includes('probeOptions'), 'Real platform option probing must be exposed safely');
assert(main.includes('fillRichTextFieldsByCDP') && main.includes('data-mention="#"') && main.includes('.hl.topic'), 'Douyin and WeChat topics must be verified as platform topic nodes');
assert(main.includes("type: 'char'") && main.includes('tag-hash-view-name-DwMEe8'), 'Douyin topic search must use real key events and an exact live candidate');
assert(adapters.includes('/x/vupre/web/archive/pre') && adapters.includes('typelist'), 'Bilibili partitions must come from the real current platform response');
assert(adapters.includes('seasonId') && adapters.includes('dataList'), 'Account collection IDs must be read from real platform state');
assert(main.includes('最终发布到') && main.includes('showMessageBox'), 'Every real publish action must require native confirmation');
assert(html.includes('Content-Security-Policy'), 'Renderer CSP is required');
assert(html.includes('data-probe="douyin"') && html.includes('data-probe="bilibili"') && html.includes('data-probe="wechat"'), 'Each platform needs independent real-option controls');
assert(html.includes('id="prepareAll"') && !html.includes('id="attachAll"') && !html.includes('id="syncMetadata"'), 'The primary workflow must be a single prepare-drafts action');
assert(renderer.includes('waitForForm') && renderer.includes('Promise.all(jobs)'), 'The one-click workflow must wait for real forms and prepare platforms concurrently');
assert(preload.includes('webUtils.getPathForFile'), 'Drag/drop must resolve local paths through Electron webUtils');
assert(!css.includes('fonts.googleapis.com'), 'Renderer must work offline');
assert(pkg.build?.nsis && pkg.build?.win, 'Windows installer configuration is required');
assert(pkg.build.files.includes('lib/**/*'), 'Security helpers must be packaged');
assert(Number(lock.packages['node_modules/electron'].version.split('.')[0]) >= 40, 'Electron security baseline must be 40+');
assert(lock.packages[''].devDependencies.electron === pkg.devDependencies.electron, 'package-lock must match package.json');

const secret = 'access_token=abc123 client_secret: verysecret Cookie=sessionid';
const safe = redact(secret);
assert(!safe.includes('abc123') && !safe.includes('verysecret') && !safe.includes('sessionid'), 'Logger must redact credentials');
assert(!redact('https://example.com/?sign_token=temporary123').includes('temporary123'), 'Logger must redact token-like URL parameters');

console.log('static-check: PASS');
