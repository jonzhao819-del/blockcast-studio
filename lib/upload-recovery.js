function sameMedia(a,b) {
  return !!a && !!b && a.path===b.path && a.size===b.size && a.mtimeMs===b.mtimeMs;
}
function uploadDecision(previous,file,targetId,current) {
  const occupied=current.hasVideo || ['uploading','processing'].includes(current.uploadStage);
  if(occupied){
    const samePage=previous?.targetId===targetId;
    const tokenMatch=previous?.token && previous.token===current.uploadToken;
    const identityMatch=previous?.videoIdentity && previous.videoIdentity===current.videoIdentity;
    const identityChanged=previous?.videoIdentity && current.videoIdentity && previous.videoIdentity!==current.videoIdentity;
    if(sameMedia(previous,file) && samePage && !identityChanged && (tokenMatch||identityMatch) && current.uploadStage!=='failed')return 'reused';
    return 'confirm-existing';
  }
  // A timed-out dispatch may have reached the platform. Never retry it blindly.
  if(previous?.targetId===targetId)return 'confirm-retry';
  return 'submit';
}
module.exports={sameMedia,uploadDecision};
