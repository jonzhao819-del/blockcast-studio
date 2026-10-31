'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const destination=process.argv[2] && path.resolve(process.argv[2]);
if(!destination)throw new Error('Provide a NEW destination directory');
if(fs.existsSync(destination))throw new Error('Destination exists; refusing to overwrite or mix source trees');
if(destination===root || destination.startsWith(root+path.sep))throw new Error('Destination must be outside the development project');
const directories=['lib','renderer','website','.github'];
const files=['main.js','preload.js','package.json','package-lock.json','LICENSE','README.md','SECURITY.md','CONTRIBUTING.md','PUBLIC_RELEASE.md','RELEASE_NOTES_0.4.0.md','RELEASE_NOTES_0.4.1.md','RELEASE_NOTES_0.4.2.md','AUDIT_0.4.0.md','TESTING.md','INSTALL_UPGRADE.md','SIGNING.md','CLEAN_MACHINE_TEST.md','.gitignore','build/icon.png',
  'scripts/build-release.ps1','scripts/generate-icon.ps1','scripts/verify-release.ps1','scripts/collect-clean-machine-report.ps1','scripts/build-website.js','scripts/export-public-source.js',
  'tests/static-check.js','tests/hardening-check.js','tests/recovery-check.js','tests/browser-check.js','tests/embedded-browser-integration.js','tests/workflow-integration.js','tests/workflow-preload.js','tests/website-check.js','tests/website-render-check.js'];
function collect(relative){
  const absolute=path.join(root,relative);const stat=fs.lstatSync(absolute);
  if(stat.isSymbolicLink())throw new Error('Symlink rejected: '+relative);
  if(stat.isDirectory())for(const entry of fs.readdirSync(absolute))collect(path.join(relative,entry));
  else if(stat.isFile())files.push(relative);
}
directories.forEach(collect);
const patterns=[
  ['GitHub credential',/(?:gh[pousr]_[a-zA-Z0-9]{25,}|github_pat_[a-zA-Z0-9_]{30,})/],
  ['Private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Personal Windows path',/[A-Z]:[\\/]+Users[\\/]+(?:JON|Jessica)[\\/]+/i],
  ['Incorrect email',/1994763499@\.com/],
  ['Private artifact name',/(?:edge-creator-profile[\\/]+Default[\\/]+(?:Cookies|Login Data))/i]
];
const report=[];
for(const relative of [...new Set(files)].sort()){
  const absolute=path.join(root,relative);if(fs.lstatSync(absolute).isSymbolicLink())throw new Error('Symlink rejected: '+relative);
  const buffer=fs.readFileSync(absolute);
  if(!relative.endsWith('.png')){
    const text=buffer.toString('utf8');
    // Regression fixtures and this scanner contain intentionally invalid synthetic examples.
    if(!['scripts/export-public-source.js','tests/website-check.js'].includes(relative.replaceAll(path.sep,'/')))
      for(const [name,pattern] of patterns)if(pattern.test(text))throw new Error(name+' requires review in '+relative);
  }
  report.push({file:relative.replaceAll(path.sep,'/'),bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')});
}
// No destination is created until every explicitly selected source file passes checks.
fs.mkdirSync(destination,{recursive:true});
for(const item of report){const target=path.join(destination,item.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,item.file),target);}
console.log(JSON.stringify({destination,files:report.length,bytes:report.reduce((sum,f)=>sum+f.bytes,0),manifest:report},null,2));
