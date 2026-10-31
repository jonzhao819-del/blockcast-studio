const path = require('path');
const fs = require('fs');

function availableBrowsers(env = process.env, exists = fs.existsSync) {
  const roots = [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean);
  const specs = [
    { id: 'edge', name: 'Microsoft Edge', suffix: ['Microsoft', 'Edge', 'Application', 'msedge.exe'] },
    { id: 'chrome', name: 'Google Chrome', suffix: ['Google', 'Chrome', 'Application', 'chrome.exe'] }
  ];
  return [...specs.flatMap(spec => {
    const executable = roots.map(root => path.join(root, ...spec.suffix)).find(exists);
    return executable ? [{ id: spec.id, name: spec.name, executable }] : [];
  }), { id: 'builtin', name: '内置浏览器', executable: null }];
}
function chooseBrowser(browsers, preferred) {
  return browsers.find(browser => browser.id === preferred) || browsers[0];
}
function profileName(id) {
  if (!['edge', 'chrome', 'builtin'].includes(id)) throw new Error('不支持的浏览器');
  return `${id}-creator-profile`;
}
module.exports = { availableBrowsers, chooseBrowser, profileName };
