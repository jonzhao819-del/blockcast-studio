const platforms = {
  douyin: { name:'抖音', icon:'抖' },
  bilibili: { name:'bilibili', icon:'哔' },
  wechat: { name:'视频号', icon:'视' }
};
let states = {};
let media = { video:null, cover:null, bilibiliCover:null, bilibiliCoverMode:null, bilibiliConfirmed:false };
let busy = false;
let coverGeneration = 0;
const prepared = new Set();
const $ = s => document.querySelector(s);
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
window.addEventListener('unhandledrejection', event => { event.preventDefault(); toast(event.reason?.message || '操作失败，请重试'); });
function invalidateReview(){ $('#consent').checked=false; $('#publishAll').disabled=true; }
function setBusy(value){
  busy=value;
  document.querySelectorAll('.metadata-card input,.metadata-card textarea,.metadata-card select,[data-probe],.media-box,#selectBilibiliCover,#confirmBilibiliCover,#resetLogins,#openAll').forEach(element=>element.disabled=value);
  $('#prepareAll').disabled=value||!media.video;
  $('#consent').disabled=value;
  if(!value)$('#confirmBilibiliCover').disabled=!media.bilibiliCover;
  invalidateReview();renderPlatforms();
}
document.querySelector('.metadata-card').addEventListener('input',()=>{ prepared.clear();invalidateReview(); });
function formatSize(bytes){const units=['B','KB','MB','GB'];let n=bytes,i=0;while(n>1024&&i<3){n/=1024;i++}return `${n.toFixed(i?1:0)} ${units[i]}`}
async function prepareBilibiliCover(file,{custom=false}={}){
  const generation=++coverGeneration;
  const panel=$('#bilibiliCoverPanel'),preview=$('#bilibiliCoverPreview'),status=$('#bilibiliCoverStatus'),confirm=$('#confirmBilibiliCover');
  media.bilibiliCover=null;media.bilibiliCoverMode=null;media.bilibiliConfirmed=false;panel.hidden=false;panel.classList.remove('confirmed','failed');preview.removeAttribute('src');status.textContent=custom?'正在检查你选择的 B 站独立封面……':'正在检查封面比例并准备 B 站回退版本……';confirm.disabled=true;confirm.textContent='确认使用此 B 站封面';
  const result=await window.blockcast.prepareBilibiliCover(file.path);
  if(generation!==coverGeneration)return;
  if(!result?.ok){panel.classList.add('failed');status.textContent=`处理失败：${result?.error||'未知错误'}。你仍可到 B 站页面手动设置。`;toast('B 站封面处理失败，已保留手动回退');return}
  media.bilibiliCover=result;media.bilibiliCoverMode=custom?'custom':'fallback';preview.src=result.previewDataUrl;
  status.textContent=custom
    ?(result.generated?`独立封面 ${result.sourceWidth}×${result.sourceHeight} 不是 4:3，已生成 ${result.width}×${result.height} 回退版本。`:`已选择 B 站独立横版封面 ${result.sourceWidth}×${result.sourceHeight}；不会影响抖音和视频号封面。`)
    :(result.generated?`通用封面 ${result.sourceWidth}×${result.sourceHeight}，已生成 ${result.width}×${result.height} 的 4:3 回退版本；也可改选已重新排版的横版封面。`:`通用封面 ${result.sourceWidth}×${result.sourceHeight} 已接近 4:3，无需生成新文件。`);
  confirm.disabled=false;toast(custom&&!result.generated?'B 站独立横版封面已读取，请确认':result.generated?'B 站 4:3 回退封面已生成，请预览确认':'封面已符合 B 站 4:3，请确认');
}

async function setMediaFile(file){
  if(busy)return;
  prepared.clear();invalidateReview();
  if(!file)return;media[file.kind]=file;$(`#${file.kind}Name`).textContent=`${file.name} · ${formatSize(file.size)} · ${file.path}`;$('#prepareAll').disabled=!media.video;renderSteps();toast(`${file.kind==='video'?'视频':'封面'}已读取，仅保存在本机`);
  if(file.kind==='cover')await prepareBilibiliCover(file);
}

function renderSteps(){const elements=[...document.querySelectorAll('.steps>div')];const active=prepared.size===3?2:media.video?1:0;elements.forEach((element,index)=>element.classList.toggle('active',index===active))}

function renderPlatforms(){
  $('#platformGrid').innerHTML=Object.entries(platforms).map(([id,p])=>{
    const s=states[id]||{}; const progress=Number.isFinite(s.progress)?Math.max(0,Math.min(100,s.progress)):0;
    return `<article class="platform-card" data-id="${id}"><header><span class="badge">${p.icon}</span><div><b>${p.name}</b><small>专用 Edge 会话</small></div><i class="state-dot ${s.connected?'on':''}"></i></header><div class="platform-body"><p>${escapeHTML(s.status||'尚未打开')}</p><div class="track"><i style="width:${progress}%"></i></div><div class="card-actions"><button class="primary" data-open="${id}">${s.connected?'切换标签页':'在 Edge 打开'}</button><button data-reload="${id}">刷新</button></div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>window.blockcast.openPlatform(b.dataset.open));
  document.querySelectorAll('[data-reload]').forEach(b=>{b.disabled=busy;b.onclick=async()=>{invalidateReview();prepared.delete(b.dataset.reload);await window.blockcast.reloadPlatform(b.dataset.reload)}});
  document.querySelectorAll('.platform-card').forEach(card=>{const bar=card.querySelector('.track i');bar.style.width=`${Math.max(0,Math.min(100,states[card.dataset.id]?.progress||0))}%`;bar.setAttribute('aria-label','平台报告的上传进度')});
}

function renderInspector(){
  $('#inspector').innerHTML=Object.entries(platforms).map(([id,p])=>{
    const s=states[id]||{}; const groups=Object.values(s.options||{}); const all=groups.flatMap(g=>g.values||[]).slice(0,16);
    const fieldCount=Object.keys(s.fields||{}).length;
    const byteText=Number.isFinite(s.bytesSent)&&Number.isFinite(s.bytesTotal)?` · 当前请求 ${formatSize(s.bytesSent)} / ${formatSize(s.bytesTotal)}（非文件总量）`:'';
    return `<div class="inspect-card"><b>${p.name} · ${fieldCount} 个可见字段</b><p>${!s.connected?'未连接':s.loginRequired?'等待扫码登录':'已连接真实页面'} · ${escapeHTML(s.uploadStage||'idle')}${Number.isFinite(s.progress)?` · ${s.progress}%`:''}${byteText}</p><div class="chips">${all.length?all.map(x=>`<span title="${escapeHTML(x.id||'')}">${escapeHTML(x.name)}</span>`).join(''):'<span>展开分区/合集后读取候选</span>'}</div></div>`;
  }).join('');
}

function renderPlatformOptions(){
  for(const id of Object.keys(platforms)){
    const scope=document.querySelector(`[data-override="${id}"]`); if(!scope)continue;
    for(const field of ['partition','collection']){
      const select=scope.querySelector(`[data-field="${field}"]`); const previous=select.value;
      const group=states[id]?.options?.[field]; const values=group?.values||[];
      const emptyLabel=field==='partition'?(id==='bilibili'?'请选择真实分区':'此平台无必选分区'):'保持当前合集';
      const html=`<option value="">${emptyLabel}</option>`+values.map(item=>`<option value="${escapeHTML(JSON.stringify([item.id||'',item.name]))}" data-id="${escapeHTML(item.id||'')}" data-name="${escapeHTML(item.name)}">${escapeHTML(item.name)}</option>`).join('');
      if(select.dataset.optionsHtml===html)continue;
      select.dataset.optionsHtml=html;select.innerHTML=html;
      if([...select.options].some(option=>option.value===previous))select.value=previous;
    }
  }
}

function update(next){states=next;renderPlatforms();renderInspector();renderPlatformOptions();renderSteps();if(Object.values(states).some(s=>!s.connected||s.loginRequired||['uploading','processing','failed'].includes(s.uploadStage)))invalidateReview();}
window.blockcast.listPlatforms().then(data=>update(data.states));
window.blockcast.onStates(update);
window.blockcast.runtimeInfo().then(info=>{
  $('#runtimeInfo').textContent=`v${info.version} · Windows ${info.arch} · ${info.edgeFound?'Edge 已就绪':'未找到 Edge'}`;
});
$('#showLogs').onclick=()=>window.blockcast.showLogs();
$('#exportDiagnostics').onclick=async()=>{
  const result=await window.blockcast.exportDiagnostics();
  if(result?.ok)toast('字段诊断已导出');
};
$('#resetLogins').onclick=async()=>{
  const result=await window.blockcast.resetLogins();
  if(result?.ok)toast('专用 Edge 登录状态已清除');
};
function payloadFor(id){
  const commonTags=$('#commonTags').value.split(/[，,\s]+/).map(x=>x.trim().replace(/^#/,'')).filter(Boolean);
  const scope=document.querySelector(`[data-override="${id}"]`);const control=field=>scope.querySelector(`[data-field="${field}"]`);const override=field=>control(field).value.trim();
  const platformTags=override('tags').split(/[，,\s]+/).map(x=>x.trim().replace(/^#/,'')).filter(Boolean);const selected=field=>{const element=control(field),option=element.selectedOptions[0];return element.value?{name:option?.dataset.name||'',id:option?.dataset.id||''}:null};
  return{title:override('title')||$('#commonTitle').value.trim(),description:override('description')||$('#commonDescription').value.trim(),tags:platformTags.length?platformTags:commonTags,visibility:override('visibility')||$('#commonVisibility').value,scheduleAt:override('schedule')||$('#commonSchedule').value,partition:selected('partition'),collection:selected('collection')};
}

async function waitForForm(id,timeoutMs=900000){const started=Date.now();let stable=0;while(Date.now()-started<timeoutMs){const data=await window.blockcast.listPlatforms();update(data.states);const state=data.states[id]||{};if(state.loginRequired)throw new Error('登录已过期，请在 Edge 重新登录');if(state.uploadStage==='failed')throw new Error(state.status||'平台上传失败');if(!state.connected&&Date.now()-started>15000)throw new Error('平台连接中断，请重新连接后重试');if(state.connected&&state.formReady&&state.hasVideo&&!['uploading','processing'].includes(state.uploadStage)&&!(state.networkInFlight>0))stable++;else stable=0;if(stable>=3)return true;await new Promise(resolve=>setTimeout(resolve,1000))}throw new Error('等待平台上传/转码超过15分钟，请到 Edge 检查')}

function addResult(id,message,ok=true){$('#results').insertAdjacentHTML('beforeend',`<div class="result ${ok?'':'error'}">${platforms[id].name}：${escapeHTML(message)}</div>`)}
document.querySelectorAll('[data-probe]').forEach(button=>button.onclick=async()=>{
  if(busy)return;
  const id=button.dataset.probe; const original=button.textContent; button.disabled=true; button.textContent='正在读取真实候选…';
  try{const result=await window.blockcast.probeOptions(id);if(result?.ok)toast(`${platforms[id].name}真实候选已更新`);else toast(result?.error||'读取候选失败');}
  finally{button.disabled=false;button.textContent=original;}
});
$('#openAll').onclick=()=>window.blockcast.openAll();
$('#confirmBilibiliCover').onclick=()=>{
  if(!media.bilibiliCover)return;
  media.bilibiliConfirmed=true;
  $('#bilibiliCoverPanel').classList.add('confirmed');
  $('#confirmBilibiliCover').textContent='✓ 已确认使用此 B 站封面';
  toast('B 站封面已人工确认，准备草稿时才会上传');
};
$('#selectBilibiliCover').onclick=async()=>{
  if(busy)return;invalidateReview();prepared.delete('bilibili');
  const file=await window.blockcast.selectMedia('cover');
  if(file)await prepareBilibiliCover(file,{custom:true});
};
document.querySelectorAll('.media-box').forEach(button=>button.onclick=async()=>{
  const kind=button.dataset.kind; const file=await window.blockcast.selectMedia(kind); if(!file)return;
  await setMediaFile(file);
});
document.querySelectorAll('.media-box').forEach(button=>{
  button.ondragover=event=>{event.preventDefault();button.classList.add('dragging')};
  button.ondragleave=()=>button.classList.remove('dragging');
  button.ondrop=async event=>{event.preventDefault();button.classList.remove('dragging');const dropped=event.dataTransfer.files[0];if(!dropped)return;const file=await window.blockcast.resolveDroppedMedia(dropped,button.dataset.kind);if(file)await setMediaFile(file);else toast('文件格式不符合该上传窗口要求')};
});
$('#prepareAll').onclick=async()=>{
  if(!media.video||busy)return;
  const task=structuredClone({media,payloads:Object.fromEntries(Object.keys(platforms).map(id=>[id,payloadFor(id)]))});
  if(Object.values(task.payloads).some(p=>!p.title)){toast('请填写通用标题或各平台标题');return;}
  const button=$('#prepareAll');setBusy(true);prepared.clear();button.textContent='正在准备三个平台草稿…';$('#results').innerHTML='';
  try{
  const jobs=Object.keys(platforms).map(async id=>{
    try{
      const media=task.media;let needsReview=false;
      if(!states[id]?.connected)throw new Error('请先打开并登录该平台');
      addResult(id,'开始真实上传视频');
      const video=await window.blockcast.attachMedia({id,filePath:media.video.path,kind:'video'});if(!video.ok)throw new Error(video.error||'视频上传控件未响应');
      await waitForForm(id);addResult(id,'投稿表单已出现，正在读取候选');
      const probed=await window.blockcast.probeOptions(id);if(!probed.ok)throw new Error(probed.error||'候选读取失败');
      const filled=await window.blockcast.fillPlatform({id,payload:task.payloads[id]});const details=filled.results?.map(item=>`${item.field}:${item.ok?'已确认':item.reason||'失败'}`).join('；')||filled.error||'无可填写字段';addResult(id,details,!!filled.ok);
      if(media.cover&&id!=='bilibili'){const cover=await window.blockcast.attachMedia({id,filePath:media.cover.path,kind:'cover'});needsReview=true;addResult(id,cover.ok?'封面已提交控件，需在真实页面确认裁剪与保存':`封面需到平台页确认：${cover.error||'控件未响应'}`,false)}
      if((media.cover||media.bilibiliCover)&&id==='bilibili'){
        needsReview=true;
        if(media.bilibiliCover&&media.bilibiliConfirmed){
          const cover=await window.blockcast.attachMedia({id,filePath:media.bilibiliCover.path,kind:'cover'});
          addResult(id,cover.ok?'已将确认的封面提交控件，需在 B 站确认裁剪与保存':`B 站封面自动上传失败，请到平台页手动设置：${cover.error||'控件未响应'}`,false);
        }else addResult(id,'B 站封面尚未人工确认，未自动上传；请确认预览或到平台页手动设置',false);
      }
      if(filled.ok&&!needsReview)prepared.add(id);
    }catch(error){addResult(id,error.message||String(error),false)}
  });
  await Promise.all(jobs);$('#mediaHint').textContent=`自动填写确认 ${prepared.size}/3；请检查各平台结果，未确认项目需在真实页完成。`;toast(`准备结束：${prepared.size}/3 自动确认，其余请查看结果`);
  }finally{button.textContent='重新准备三个平台草稿';setBusy(false);renderSteps();}
};
document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>window.blockcast.focusPlatform(button.dataset.review));
$('#consent').onchange=e=>{const ready=!busy&&Object.keys(platforms).every(id=>states[id]?.connected&&states[id]?.readyToPublish);$('#publishAll').disabled=!e.target.checked||!ready;if(e.target.checked&&!ready){e.target.checked=false;toast('三平台尚未全部就绪，请先在真实投稿页补全并复核');}};
$('#publishAll').onclick=async()=>{
  if(!$('#consent').checked||busy)return;
  const button=$('#publishAll');setBusy(true);button.textContent='正在逐个平台确认发布…';
  try{
  for(const id of Object.keys(platforms)){
    const result=await window.blockcast.publish(id);
    $('#results').insertAdjacentHTML('beforeend',`<div class="result ${result.ok?'':'error'}">${platforms[id].name}：${escapeHTML(result.ok?'已点击平台真实发布按钮，等待平台响应':result.error||'提交失败')}</div>`);
    if(!result.ok){toast('发布流程已停止，请核对当前平台结果');break;}
  }
  }finally{button.textContent='⚑ 最终发布到三个平台';setBusy(false);invalidateReview();}
};
