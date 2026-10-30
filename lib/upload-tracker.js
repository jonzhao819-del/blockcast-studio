// A chunk's Content-Length is not the video's total size. Never present it as
// whole-video progress; only the platform's own progress can supply that value.
function createUploadTracker(update) {
  const requests = new Set();
  const failed = new Set();
  return (method, params) => {
    if (method === 'Runtime.bindingCalled' && params.name === '__blockcastUploadProgress') {
      try {
        const data = JSON.parse(params.payload);
        if (data.binary !== true || !Number.isFinite(data.loaded) || !Number.isFinite(data.total) || data.total <= 0 || data.loaded < 0 || data.loaded > data.total) return;
        update({ uploadStage: 'uploading', status: `当前上传请求 ${Math.round(data.loaded / data.total * 100)}%（非视频总进度）`, progress: null, bytesSent: data.loaded, bytesTotal: data.total, progressSource: 'xhr-upload-bytes', progressScope: 'request', readyToPublish: false });
      } catch {}
    }
    if (method === 'Network.requestWillBeSent') {
      const request = params.request || {};
      let pathname = '';
      try { pathname = new URL(request.url).pathname; } catch {}
      if (['POST', 'PUT', 'PATCH'].includes(request.method) && /upload|upos|multipart|chunk/i.test(pathname) && !/preupload|init|complete|status|auth|token|apply|finish/i.test(pathname)) {
        requests.add(params.requestId);
        update({ uploadStage: 'uploading', status: '真实上传请求进行中', networkInFlight: requests.size, readyToPublish: false });
      }
    }
    if (method === 'Network.responseReceived' && requests.has(params.requestId) && params.response?.status >= 400) {
      failed.add(params.requestId);
      update({ uploadStage: 'failed', status: `上传接口返回 HTTP ${params.response.status}`, readyToPublish: false });
    }
    if (method === 'Network.loadingFailed' && requests.delete(params.requestId)) {
      failed.delete(params.requestId);
      update({ uploadStage: 'failed', status: `上传请求失败：${params.errorText || '网络错误'}`, networkInFlight: requests.size, readyToPublish: false });
    }
    if (method === 'Network.loadingFinished' && requests.delete(params.requestId)) {
      const wasFailed = failed.delete(params.requestId);
      update({ uploadStage: wasFailed ? 'failed' : requests.size ? 'uploading' : 'processing', status: wasFailed ? '上传接口报错，请到平台检查' : requests.size ? '其余上传请求进行中' : '上传请求结束，等待平台确认/转码', networkInFlight: requests.size, readyToPublish: false });
    }
  };
}
module.exports = { createUploadTracker };
