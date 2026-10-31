'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { render, validateConfig } = require('../scripts/build-website');
const config = require('../website/site.config.json');
const clone = () => structuredClone(config);
test('public identity, platforms, MIT and corrected contact are present', () => {
  const html = render(config);
  for (const value of ['方块发布站', '一键多平台发布视频', '抖音、B站、视频号', '1994763499@qq.com', 'MIT']) assert(html.includes(value));
  assert(!html.includes('1994763499@.com'));
  assert(!html.includes('{{'));
});
test('unpublished release never exposes a false download link', () => {
  const c = clone(); c.release.published = false;
  const html = render(c);
  assert(html.includes('安装包待公开发布'));
  assert(!html.includes('/releases/download/'));
});
test('published release links to only the configured GitHub release', () => {
  const c = clone(); c.repositoryPublished = true; c.release.published = true;
  const html = render(c);
  assert(html.includes('https://github.com/jonzhao819-del/blockcast-studio/releases/download/'+c.release.tag+'/'+c.release.asset));
  assert(html.includes('https://github.com/jonzhao819-del/blockcast-studio/issues'));
});
test('invalid email, repository, release integrity and inconsistent publication fail closed', () => {
  for (const mutate of [c=>c.contactEmail='1994763499@.com', c=>c.repository='javascript:alert(1)', c=>c.release.sha256='bad', c=>c.release.asset='../private.exe', c=>{c.release.published=true;c.repositoryPublished=false;}]) {
    const c=clone();mutate(c);assert.throws(()=>validateConfig(c));
  }
});
test('all in-page navigation targets exist and IDs are unique', () => {
  const html=render(config);const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const m of html.matchAll(/href="#([^"]+)"/g))assert(ids.includes(m[1]),m[1]);
});
test('page is public and local assets do not request third-party scripts', () => {
  const html=render(config);assert(!/<form\b|type="password"|<iframe\b/i.test(html));
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if(!match[1].startsWith('https://github.com/')) assert(!/^https?:/i.test(match[1]));
  assert(html.includes("connect-src 'none'"));assert(html.includes('网站无需登录'));
});
test('manual review and unverified features remain disclosed', () => {
  const html=render(config);for(const value of ['未做 Authenticode 签名','封面需要发布者在各平台手动上传','未执行真实发布','修复版仍待该电脑复测','分片字节只表示当前请求'])assert(html.includes(value));
});
test('CSS supports reduced motion, focus and mobile layouts', () => {
  const css=fs.readFileSync(path.join(__dirname,'../website/styles.css'),'utf8');
  for(const value of ['prefers-reduced-motion','focus-visible','max-width:420px','min-height:44px'])assert(css.includes(value));
});
const installer=path.join(__dirname,'../dist',config.release.asset);
test('local installer metadata matches its actual bytes',{skip:!fs.existsSync(installer)},()=>{
  const data=fs.readFileSync(installer);assert.equal(data.length,config.release.sizeBytes);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex').toUpperCase(),config.release.sha256);
});
