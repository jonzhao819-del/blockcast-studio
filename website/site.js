'use strict';
const copyButton = document.querySelector('#copy-checksum');
copyButton?.addEventListener('click', async () => {
  const checksum = document.querySelector('#checksum');
  const status = document.querySelector('#copy-status');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(checksum.textContent.trim());
    status.textContent = '已复制';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(checksum);
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = '无法自动复制，已选中校验值，请手动复制。';
  }
});
