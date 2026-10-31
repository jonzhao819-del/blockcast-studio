const platforms = { douyin:{name:'抖音',icon:'抖'}, bilibili:{name:'B站',icon:'哔'}, wechat:{name:'视频号',icon:'视'} };
const ids=Object.keys(platforms);
const $=selector=>document.querySelector(selector);
const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
let states={},media={video:null},publishing=false,opening=false,browserName='专用浏览器',browserId='';
const prepared=new Set();
const work=Object.fromEntries(ids.map(id=>[id,{task:null,videoKey:'',revision:0,filledRevision:-1,error:'',raw:'',results:[],lastAction:'upload',submitted:false}]));
const draftKey='blockcast-draft-v1';
const fieldNames={title:'标题',description:'简介',tags:'话题',partition:'分区',collection:'合集',schedule:'定时',visibility:'可见性'};
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),5000);}
function friendlyError(raw){
 const message=String(raw||'操作暂未完成');
 if(/timed out|超时|连接中断|连接已关闭|未连接|暂时无法读取/.test(message))return '页面暂时没有响应。打开该平台检查，再点“重新连接”后继续；已选视频和文字会保留。';
 if(/未找到.*控件|控件不唯一|多个同类|素材控件/.test(message))return '请在该平台进入视频投稿页，再重试。也可在平台手动上传视频后，点击“核对并继续”。';
 if(/登录|扫码/.test(message))return '请先在该平台的专用窗口完成登录，再继续操作。';
 if(/ENOENT|素材未选择|选择后已改变|文件格式|素材路径/.test(message))return '视频文件已移动、修改或无法读取，请重新选择主视频。已填写的文字会保留。';
 if(/候选|真实 ID|partition|collection/.test(message))return '请展开该平台单独设置，更新分区和合集选项；也可直接到平台手动补全。';
 if(/title|标题/.test(message)&&!message.startsWith('请到'))return '请填写通用标题，或在该平台单独设置中填写标题。';
 return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}
window.addEventListener('unhandledrejection',event=>{event.preventDefault();toast(friendlyError(event.reason?.message));});
function formatSize(bytes){const units=['B','KB','MB','GB'];let value=bytes,index=0;while(value>=1024&&index<3){value/=1024;index++;}return `${value.toFixed(index?1:0)} ${units[index]}`;}
function videoKey(){return media.video?JSON.stringify([media.video.path,media.video.size,media.video.mtimeMs]):'';}
function anyTask(){return publishing||opening||ids.some(id=>work[id].task);}
function usable(id){return states[id]?.connected&&!states[id]?.loginRequired;}
function videoReady(id){const s=states[id]||{};return usable(id)&&s.formReady&&s.hasVideo&&!['uploading','processing','failed'].includes(s.uploadStage)&&!(s.networkInFlight>0);}
function eligibleUpload(id){return !opening&&!!media.video&&usable(id)&&!work[id].task&&!work[id].submitted&&(work[id].videoKey!==videoKey()||work[id].lastAction==='upload'&&!!work[id].error);}
function eligibleFill(id){return !opening&&!!media.video&&work[id].videoKey===videoKey()&&videoReady(id)&&!work[id].task&&!work[id].submitted&&work[id].filledRevision!==work[id].revision;}
function invalidateReview(id){
 $('#consent').checked=false;$('#publishAll').disabled=true;
 for(const platform of id?[id]:ids)document.querySelectorAll(`[data-review-check="${platform}"]`).forEach(el=>el.checked=false);
}
function allReviewed(id){return [...document.querySelectorAll(`[data-review-check="${id}"]`)].every(el=>el.checked);}
function canPublish(){return !anyTask()&&ids.filter(id=>!work[id].submitted).every(id=>usable(id)&&states[id]?.readyToPublish&&allReviewed(id))&&ids.some(id=>!work[id].submitted);}
function buildCards(){
 $('#platformGrid').innerHTML=ids.map(id=>`<article class="platform-card" data-id="${id}"><header><span class="badge">${platforms[id].icon}</span><div><b>${platforms[id].name}</b><small class="browser-label"></small></div><i class="state-dot"></i></header><div class="platform-body"><strong class="phase-label"></strong><p class="state-summary" role="status"></p><div class="track" role="progressbar" aria-label="${platforms[id].name}平台上传进度"><i></i></div><p class="progress-copy"></p><div class="card-actions"><button data-open="${id}">打开平台</button><button data-reload="${id}">重新连接</button><button class="primary task-action" data-task="${id}">上传视频</button></div><details class="platform-detail"><summary>操作详情</summary><pre></pre></details></div></article>`).join('');
 $('#reviewGrid').innerHTML=ids.map(id=>`<article class="review-card" data-review-card="${id}"><h3>${platforms[id].name}</h3><p class="review-summary"></p><ul class="review-missing"></ul><button data-review="${id}">打开${platforms[id].name}投稿页</button><label><input type="checkbox" data-review-check="${id}" data-item="cover">封面已手动上传，裁剪和保存已确认</label><label><input type="checkbox" data-review-check="${id}" data-item="content">标题、简介和话题已核对</label><label><input type="checkbox" data-review-check="${id}" data-item="settings">${id==='bilibili'?'分区、合集、':'合集、'}可见性和定时已核对</label></article>`).join('');
 document.querySelectorAll('[data-open],[data-review]').forEach(button=>button.onclick=async()=>{try{await window.blockcast.openPlatform(button.dataset.open||button.dataset.review);}catch(error){toast(friendlyError(error.message));}});
 document.querySelectorAll('[data-reload]').forEach(button=>button.onclick=()=>reconnect(button.dataset.reload));
 document.querySelectorAll('[data-task]').forEach(button=>button.onclick=()=>{const id=button.dataset.task;return eligibleFill(id)?fillOne(id):uploadOne(id);});
 document.querySelectorAll('[data-review-check]').forEach(input=>input.onchange=()=>{$('#consent').checked=false;renderActions();});
}
function phaseFor(id){
 const s=states[id]||{},w=work[id];
 if(w.submitted)return ['已提交发布操作','已点击平台发布按钮，请到平台查看实际发布结果。'];
 if(w.error)return ['需要处理',w.error];
 if(!s.connected)return ['待连接','打开平台并登录；已打开时可重新连接。'];
 if(s.loginRequired)return ['待登录','请在平台窗口扫码或完成验证。'];
 if(w.task==='fill')return ['正在填写','正在写入本次点击时的信息；你可以继续编辑，修改后再同步。'];
 if(s.uploadStage==='failed')return ['上传未完成','请到平台检查上传失败原因，再继续。'];
 if(s.uploadStage==='processing')return ['平台处理中','等待转码完成，可以继续填写下方信息。'];
 if(w.task==='upload'||s.uploadStage==='uploading'||s.networkInFlight>0)return ['上传中','视频正在传给平台，下方发布信息仍可编辑。'];
 if(prepared.has(id))return ['待你复核','信息已填写；封面和发布设置仍需你在平台确认。'];
 if(w.videoKey===videoKey()&&media.video)return ['待填写信息','视频已就绪，填写下方信息后同步到草稿。'];
 if(s.hasVideo)return ['已有视频待核对','可选择主视频后点“核对并继续”，避免重复上传。'];
 return ['待上传','平台已连接，选择主视频即可上传。'];
}
function renderPlatforms(){
 for(const id of ids){
  const card=document.querySelector(`[data-id="${id}"]`),s=states[id]||{},w=work[id],phase=phaseFor(id);
  card.querySelector('.browser-label').textContent=browserName;
  card.querySelector('.state-dot').classList.toggle('on',!!s.connected);
  card.querySelector('.phase-label').textContent=phase[0];card.querySelector('.state-summary').textContent=phase[1];card.dataset.error=String(!!w.error||s.uploadStage==='failed');
  const progress=Number.isFinite(s.progress)?Math.max(0,Math.min(100,s.progress)):null;
  card.querySelector('.track i').style.width=`${progress??0}%`;
  const track=card.querySelector('.track');track.hidden=progress===null&&w.task!=='upload';if(progress===null)track.removeAttribute('aria-valuenow');else track.setAttribute('aria-valuenow',String(progress));
  card.querySelector('.progress-copy').textContent=progress!==null?`平台上传进度 ${progress}%`:s.bytesTotal>0?`当前分片 ${formatSize(s.bytesSent||0)} / ${formatSize(s.bytesTotal)}（非视频总进度）`:'';
  card.querySelector('[data-open]').textContent=s.connected?'切换到平台':'打开平台';
  card.querySelector('[data-reload]').disabled=!!w.task||publishing;
  const task=card.querySelector('[data-task]');task.disabled=publishing||!!w.task||!(eligibleFill(id)||eligibleUpload(id));
  task.hidden=!media.video;
  task.textContent=w.task==='upload'?'等待视频就绪…':w.task==='fill'?'正在填写…':w.submitted?'请查看发布结果':eligibleFill(id)?w.error?'重试填写':'填写此平台草稿':w.videoKey===videoKey()&&media.video?'已完成当前填写':s.hasVideo?'核对并继续':w.error?'重试上传':'上传至此平台';
  card.querySelector('.platform-detail pre').textContent=[s.status,w.raw,...w.results.map(r=>`${fieldNames[r.field]||r.field}：${r.ok?'已确认':r.reason||'需手动检查'}`)].filter(Boolean).join('\n')||'尚未执行操作。';
  card.querySelector('.platform-detail').hidden=!w.raw&&!w.results.length&&!w.error;
 }
}
function renderReview(){
 for(const id of ids){
  const card=document.querySelector(`[data-review-card="${id}"]`),w=work[id];
  const failed=[...new Set(w.results.filter(r=>!r.ok).map(r=>fieldNames[r.field]||'平台字段'))];
  card.querySelector('.review-summary').textContent=w.submitted?'发布操作已提交，请查看平台结果':prepared.has(id)?'自动填写已完成，仍需人工复核':failed.length?`请在平台补全：${failed.join('、')}`:'视频和信息完成后，请逐项检查。';
  const missing=[];
  if(!card.querySelector('[data-item=cover]').checked)missing.push('封面上传与保存：待你确认');
  if(!card.querySelector('[data-item=content]').checked)missing.push('标题、简介与话题：待你确认');
  if(!card.querySelector('[data-item=settings]').checked)missing.push(`${id==='bilibili'?'分区、':''}合集与发布设置：待你确认`);
  card.querySelector('.review-missing').innerHTML=missing.map(text=>`<li>${escapeHTML(text)}</li>`).join('')||'<li>人工复核已完成</li>';
  card.querySelectorAll('input').forEach(input=>input.disabled=publishing||!!w.task||w.submitted||!usable(id));
 }
}
function renderActions(){
 const tasks=anyTask();
 $('.media-box').disabled=tasks;$('#browserSelect').disabled=tasks||opening;$('#resetLogins').disabled=tasks;$('#openAll').disabled=publishing||opening;
 document.querySelectorAll('.metadata-card input,.metadata-card textarea,.metadata-card select').forEach(el=>el.disabled=publishing);
 document.querySelectorAll('[data-probe]').forEach(el=>el.disabled=publishing||!!work[el.dataset.probe].task||!videoReady(el.dataset.probe));
 $('#uploadAll').disabled=publishing||!ids.some(eligibleUpload);$('#fillAll').disabled=publishing||!ids.some(eligibleFill);
 const uploading=ids.filter(id=>work[id].task==='upload').length,ready=ids.filter(id=>work[id].videoKey===videoKey()&&media.video).length;
 $('#mediaHint').textContent=!media.video?'选择主视频并连接平台后即可上传。':uploading?`${uploading} 个平台正在上传 / 处理，可以继续填写下方信息。`:`视频就绪 ${ready}/3；未连接的平台可稍后单独继续。`;
 $('#fillHint').textContent=`已填写 ${prepared.size}/3 个平台。${prepared.size?'修改信息后可再次同步；已完成的平台不会重复上传视频。':'视频就绪后点击填写，不会自动点击发布。'}`;
 $('#consent').disabled=tasks||ids.every(id=>work[id].submitted);
 $('#publishAll').disabled=!$('#consent').checked||!canPublish();
 $('#publishHint').textContent=ids.every(id=>work[id].submitted)?'发布操作已提交，请分别到平台查看实际结果。':canPublish()?'复核已完成，勾选后逐个平台确认发布。':'请先完成视频和必填项，再核对各平台封面、内容及发布设置。';
 const active=prepared.size===3?3:ready||uploading?2:media.video?1:0;
 document.querySelectorAll('.steps>div').forEach((el,i)=>el.classList.toggle('active',i===active));renderReview();
}
function renderPlatformOptions(){
 for(const id of ids){const scope=document.querySelector(`[data-override="${id}"]`);
  for(const field of ['partition','collection']){
   const select=scope.querySelector(`[data-field="${field}"]`),previous=select.value;
   const values=states[id]?.options?.[field]?.values||[];
   const html=`<option value="">${field==='partition'?(id==='bilibili'?'在平台选择或使用当前分区':'此平台无需分区'):'保持平台当前合集'}</option>`+values.map(item=>`<option value="${escapeHTML(JSON.stringify([item.id||'',item.name]))}" data-id="${escapeHTML(item.id||'')}" data-name="${escapeHTML(item.name)}">${escapeHTML(item.name)}</option>`).join('');
   if(select.dataset.optionsHtml!==html){select.dataset.optionsHtml=html;select.innerHTML=html;if([...select.options].some(option=>option.value===previous))select.value=previous;else if(previous)metadataChanged(id);}
  }
 }
}
function update(next){
 const previous=states;states=next||{};
 for(const id of ids){const s=states[id]||{},before=previous[id]||{};
  if(!s.connected||s.loginRequired||['uploading','processing','failed'].includes(s.uploadStage))invalidateReview(id);
  if(before.hasVideo&&!s.hasVideo&&s.connected&&!work[id].task){work[id].videoKey='';work[id].filledRevision=-1;prepared.delete(id);invalidateReview(id);}
 }
 renderPlatforms();renderPlatformOptions();renderActions();
}
function metadataChanged(id){for(const key of id?[id]:ids){work[key].revision++;prepared.delete(key);invalidateReview(key);}saveDraft();renderPlatforms();renderActions();}
function draftControls(){return [...document.querySelectorAll('.metadata-card input,.metadata-card textarea,.metadata-card select')].filter(el=>!['partition','collection'].includes(el.dataset.field));}
function controlKey(el){return el.id||el.closest('[data-override]').dataset.override+':'+el.dataset.field;}
function saveDraft(){try{localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(draftControls().map(el=>[controlKey(el),el.value]))));}catch{toast('本机草稿保存失败，请检查磁盘空间');}}
function setMediaFile(file){
 if(anyTask()||!file||file.kind!=='video')return;
 media.video=file;prepared.clear();invalidateReview();
 for(const id of ids)Object.assign(work[id],{videoKey:'',filledRevision:-1,error:'',raw:'',results:[],lastAction:'upload',submitted:false});
 $('#videoButtonLabel').textContent='更换主视频';$('#videoName').textContent=`${file.name} · ${formatSize(file.size)}`;$('#videoName').title=file.path;
 renderPlatforms();renderActions();saveDraft();
}
function payloadFor(id){
 const scope=document.querySelector(`[data-override="${id}"]`),control=field=>scope.querySelector(`[data-field="${field}"]`),override=field=>control(field).value.trim();
 const tags=value=>value.split(/[，,\s]+/).map(v=>v.trim().replace(/^#+/,'')).filter(Boolean);
 const selected=field=>{const element=control(field),option=element.selectedOptions[0];return element.value?{name:option?.dataset.name||'',id:option?.dataset.id||''}:null;};
 return {title:override('title')||$('#commonTitle').value.trim(),description:override('description')||$('#commonDescription').value.trim(),tags:tags(override('tags')||$('#commonTags').value),visibility:override('visibility')||$('#commonVisibility').value,scheduleAt:override('schedule')||$('#commonSchedule').value,partition:selected('partition'),collection:selected('collection')};
}
async function waitForForm(id,timeoutMs=900000){
 const started=Date.now();let stable=0,disconnectedAt=null;
 while(Date.now()-started<timeoutMs){
  const data=await window.blockcast.listPlatforms();update(data.states);const s=states[id]||{};
  if(s.loginRequired)throw new Error('登录已过期，请在专用平台窗口重新登录');
  if(s.uploadStage==='failed')throw new Error(s.status||'平台上传失败，请到平台检查后重试');
  if(!s.connected){disconnectedAt??=Date.now();if(Date.now()-disconnectedAt>15000)throw new Error('平台连接中断');}else disconnectedAt=null;
  stable=videoReady(id)?stable+1:0;if(stable>=2)return;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw new Error('上传或转码超过15分钟，请到平台检查。已选视频与文字保留');
}
async function uploadOne(id){
 if(!eligibleUpload(id)||publishing)return;
 const w=work[id],file=structuredClone(media.video),key=videoKey();
 Object.assign(w,{task:'upload',error:'',raw:'',lastAction:'upload',results:[]});invalidateReview(id);renderPlatforms();renderActions();
 try{
  const result=await window.blockcast.attachMedia({id,filePath:file.path,kind:'video'});
  if(!result?.ok)throw new Error(result?.error||'视频上传控件未响应');
  w.raw=result.status==='reused'?'已核对并继续使用平台已有视频，未重复上传。':'视频已提交平台，等待上传与转码。';
  await waitForForm(id);w.videoKey=key;
 }catch(error){w.raw=error.message;w.error=friendlyError(error.message);}
 finally{w.task=null;renderPlatforms();renderActions();}
}
async function fillOne(id){
 if(!eligibleFill(id)||publishing)return;
 const payload=structuredClone(payloadFor(id)),w=work[id],revision=w.revision;
 if(!payload.title){toast('请填写通用标题或该平台的独立标题。');const scope=document.querySelector(`[data-override="${id}"]`);(scope.open?scope.querySelector('[data-field=title]'):$('#commonTitle')).focus();return;}
 Object.assign(w,{task:'fill',error:'',raw:'',lastAction:'fill'});invalidateReview(id);prepared.delete(id);renderPlatforms();renderActions();
 try{
  // Filling an existing draft never invokes the upload path.
  const result=await window.blockcast.fillPlatform({id,payload});w.results=result?.results||[];
  if(!result?.ok){const fields=[...new Set(w.results.filter(r=>!r.ok).map(r=>fieldNames[r.field]||'平台字段'))];w.raw=result?.error||w.results.filter(r=>!r.ok).map(r=>r.reason).join('；');throw new Error(fields.length?`请到${platforms[id].name}补全${fields.join('、')}，或调整后重试填写。`:result?.error||'填写暂未完成，请到平台检查');}
  if(w.revision===revision){w.filledRevision=revision;prepared.add(id);}else w.raw='本次填写已完成，但你刚修改了信息，请再同步一次。';
 }catch(error){w.raw=w.raw||error.message;w.error=friendlyError(error.message);}
 finally{w.task=null;renderPlatforms();renderActions();}
}
async function reconnect(id){
 const w=work[id];if(w.task||publishing)return;w.task='connect';invalidateReview(id);renderPlatforms();renderActions();
 try{const result=await window.blockcast.reloadPlatform(id);if(!result?.ok)throw new Error(result?.error||'平台连接暂未恢复');w.error='';w.raw='重新连接完成，平台页面与所选视频保留。';const data=await window.blockcast.listPlatforms();update(data.states);}
 catch(error){w.error=friendlyError(error.message);w.raw=error.message;}finally{w.task=null;renderPlatforms();renderActions();}
}
function applyBrowserInfo(info){
 if(!info)return;browserName=info.current.name;browserId=info.current.id;
 $('#browserSelect').innerHTML=info.available.map(browser=>`<option value="${escapeHTML(browser.id)}">${escapeHTML(browser.name)}</option>`).join('');$('#browserSelect').value=browserId;
 $('#browserHint').textContent=browserId==='builtin'?'使用安装包自带浏览器，三个平台分别打开独立窗口；无需另装 Edge 或 Chrome。':'使用'+browserName+'专用会话；没有 Edge 或 Chrome 的电脑可使用内置浏览器。';
 renderPlatforms();renderActions();
}
buildCards();
try{const saved=JSON.parse(localStorage.getItem(draftKey)||'{}');for(const el of draftControls()){if(typeof saved[controlKey(el)]==='string')el.value=saved[controlKey(el)];}}catch{}
$('.metadata-card').addEventListener('input',event=>metadataChanged(event.target.closest('[data-override]')?.dataset.override));
$('.metadata-card').addEventListener('change',event=>{if(event.target.tagName==='SELECT')metadataChanged(event.target.closest('[data-override]')?.dataset.override);});
$('.media-box').onclick=async()=>{if(!anyTask())setMediaFile(await window.blockcast.selectMedia('video'));};
$('.media-box').ondragover=event=>{event.preventDefault();if(!anyTask())$('.media-box').classList.add('dragging');};
$('.media-box').ondragleave=()=>$('.media-box').classList.remove('dragging');
$('.media-box').ondrop=async event=>{event.preventDefault();$('.media-box').classList.remove('dragging');if(anyTask())return;const dropped=event.dataTransfer.files[0];if(!dropped)return;const file=await window.blockcast.resolveDroppedMedia(dropped,'video');if(file)setMediaFile(file);else toast('请选择 MP4、MOV、MKV 或 WebM 视频');};
$('#uploadAll').onclick=()=>Promise.all(ids.filter(eligibleUpload).map(uploadOne));
$('#fillAll').onclick=()=>Promise.all(ids.filter(eligibleFill).map(fillOne));
$('#openAll').onclick=async()=>{opening=true;renderActions();try{await window.blockcast.openAll();}catch(error){toast(friendlyError(error.message));}finally{opening=false;renderActions();}};
$('#browserSelect').onchange=async()=>{
 const selected=$('#browserSelect').value;opening=true;renderActions();
 try{const result=await window.blockcast.selectBrowser(selected);if(!result?.ok){$('#browserSelect').value=browserId;if(!result?.canceled)toast(friendlyError(result?.error));return;}
  for(const id of ids){work[id].videoKey='';work[id].filledRevision=-1;work[id].error='';work[id].submitted=false;}prepared.clear();invalidateReview();applyBrowserInfo(result.browser);
 }catch(error){$('#browserSelect').value=browserId;toast(friendlyError(error.message));}finally{opening=false;renderActions();}
};
document.querySelectorAll('[data-probe]').forEach(button=>button.onclick=async()=>{
 const id=button.dataset.probe,w=work[id];if(w.task||publishing)return;w.task='options';renderActions();
 try{const result=await window.blockcast.probeOptions(id);if(!result?.ok)throw new Error(result?.error||'读取候选失败');const data=await window.blockcast.listPlatforms();update(data.states);toast('已更新当前账号的分区和合集选项');}
 catch(error){w.error=friendlyError(error.message);w.raw=error.message;}finally{w.task=null;renderPlatforms();renderActions();}
});
$('#consent').onchange=()=>{if($('#consent').checked&&!canPublish()){$('#consent').checked=false;toast('请先在各平台补全必填项，并完成下方三项人工复核。');}renderActions();};
$('#publishAll').onclick=async()=>{
 if(!$('#consent').checked||!canPublish())return;publishing=true;$('#consent').checked=false;renderActions();
 try{for(const id of ids.filter(id=>!work[id].submitted)){
  const result=await window.blockcast.publish(id);
  if(!result?.ok){work[id].error=result?.canceled?'已取消发布；请核对后再继续。':friendlyError(result?.error);work[id].raw=result?.error||'';break;}
  work[id].submitted=true;work[id].error='';
 }}catch(error){toast(friendlyError(error.message));}finally{publishing=false;renderPlatforms();renderActions();}
};
$('#showLogs').onclick=()=>window.blockcast.showLogs();
$('#exportDiagnostics').onclick=async()=>{if((await window.blockcast.exportDiagnostics())?.ok)toast('字段诊断已导出');};
$('#resetLogins').onclick=async()=>{if((await window.blockcast.resetLogins())?.ok){invalidateReview();toast('当前浏览器的专用登录状态已清除');}};
window.blockcast.onStates(update);
window.blockcast.listPlatforms().then(data=>update(data.states));
window.blockcast.runtimeInfo().then(info=>{applyBrowserInfo(info.browser);$('#runtimeInfo').textContent=`v${info.version} · Windows ${info.arch} · 已包含内置浏览器`;});
window.blockcast.restoreMedia().then(result=>{if(result?.file&&!media.video&&!anyTask())setMediaFile(result.file);if(result?.error&&!media.video)toast(result.error);});
renderPlatforms();renderActions();
