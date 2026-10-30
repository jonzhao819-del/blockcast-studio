'use strict';
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const source = path.join(project, 'website');
const output = path.join(project, '.site');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function validateConfig(config) {
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(config.contactEmail)) throw new Error('Invalid contactEmail');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new Error('repository must be owner/repo');
  if (config.license !== 'MIT') throw new Error('The confirmed license is MIT');
  if (typeof config.repositoryPublished !== 'boolean') throw new Error('Repository state must be explicit');
  const r = config.release;
  if (!r || !/^\d+\.\d+\.\d+$/.test(r.version) || r.tag !== 'v' + r.version || r.asset !== 'Blockcast-Studio-Setup-' + r.version + '.exe') throw new Error('Release naming mismatch');
  if (!/^[A-Fa-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.sizeBytes) || r.sizeBytes <= 0) throw new Error('Invalid release integrity metadata');
  if (typeof r.published !== 'boolean' || typeof r.signed !== 'boolean') throw new Error('Release state must be explicit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt)) throw new Error('Invalid verification date');
  if (r.published && !config.repositoryPublished) throw new Error('A public download requires a published repository');
  return config;
}

function render(config) {
  validateConfig(config);
  const r = config.release;
  const repo = config.repositoryPublished ? 'https://github.com/' + config.repository : '';
  const download = repo && r.published ? repo + '/releases/download/' + encodeURIComponent(r.tag) + '/' + encodeURIComponent(r.asset) : '';
  const link = (url, label, className='button') => '<a class="' + className + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
  const values = {
    VERSION: r.version, VERIFIED_AT: r.verifiedAt, CONTACT_EMAIL: config.contactEmail, ASSET: r.asset, SHA256: r.sha256.toUpperCase(),
    SIZE: (r.sizeBytes / 1048576).toFixed(1), SIGNATURE_STATUS: r.signed ? '已签名（以安装包验证结果为准）' : '未签名测试版',
    DOWNLOAD_CONTROL: download ? link(download, '下载 Windows 安装包 ↓', 'button primary') : '<button class="button" type="button" disabled aria-describedby="download-state">安装包待公开发布</button>',
    DOWNLOAD_STATUS: download ? '从项目 GitHub Releases 下载。无需注册本站账号。' : '本地安装包已生成，尚未上传到公开下载区。发布完成前不会显示虚假下载链接。',
    SOURCE_CONTROL: repo ? link(repo, '查看 GitHub 源码 ↗') : '<button class="button" type="button" disabled>GitHub 仓库准备中</button>',
    ISSUE_CONTROL: repo ? link(repo + '/issues', '反馈问题 ↗', 'text-link') : '<p>仓库公开前，可先通过邮箱联系。</p>',
    SOURCE_STATUS: repo ? '源码以 MIT 许可证开放，具体条款见仓库 LICENSE 文件。' : '已采用 MIT 许可证；GitHub 公开发布正在准备中。'
  };
  const rawKeys = new Set(['DOWNLOAD_CONTROL', 'SOURCE_CONTROL', 'ISSUE_CONTROL']);
  return fs.readFileSync(path.join(source, 'index.html'), 'utf8').replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error('Unknown template token: ' + key);
    return rawKeys.has(key) ? values[key] : escapeHtml(values[key]);
  });
}

function build() {
  const config = JSON.parse(fs.readFileSync(path.join(source, 'site.config.json'), 'utf8'));
  const html = render(config);
  // Only copy the explicit public website files. Never serve the project root.
  fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), html);
  for (const name of ['styles.css', 'site.js']) fs.copyFileSync(path.join(source, name), path.join(output, name));
  fs.copyFileSync(path.join(source, 'assets', 'block.svg'), path.join(output, 'assets', 'block.svg'));
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  console.log('Website built: ' + output);
  console.log('Repository: ' + config.repository + '; download: ' + (config.release.published ? 'configured' : 'pending') + '; contact: ' + config.contactEmail);
  return output;
}
if (require.main === module) build();
module.exports = { render, validateConfig, build };
