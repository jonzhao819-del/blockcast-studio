const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {availableBrowsers,chooseBrowser,profileName}=require('../lib/browsers');
test('no installed browser uses bundled Chromium without a download',()=>{
 const found=availableBrowsers({},()=>false);assert.deepEqual(found.map(b=>b.id),['builtin']);assert.equal(chooseBrowser(found,'edge').id,'builtin');
});
test('Chrome-only Windows is supported; absent environment variables never search relative executables',()=>{
 const seen=[],found=availableBrowsers({LOCALAPPDATA:'C:/fixture-local'},p=>{seen.push(p);return p.endsWith('chrome.exe');});
 assert.deepEqual(found.map(b=>b.id),['chrome','builtin']);assert(seen.every(p=>path.isAbsolute(p)));
 assert.equal(chooseBrowser(found).id,'chrome');assert.equal(chooseBrowser(found,'builtin').id,'builtin');
 assert.equal(profileName('edge'),'edge-creator-profile');assert.notEqual(profileName('chrome'),profileName('edge'));assert.throws(()=>profileName('../other'));
});
