function sharedSource() {
  return `
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = element => !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
    const roots = [document];
    for (let index = 0; index < roots.length && index < 40; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
        if (element.tagName === 'IFRAME') { try { if (element.contentDocument && !roots.includes(element.contentDocument)) roots.push(element.contentDocument); } catch {} }
      }
    }
    const all = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
    const firstVisible = selector => all(selector).find(visible);
    const textOf = element => clean(element?.innerText || element?.textContent);
    const body = clean(roots.map(root => root.body?.innerText || root.host?.innerText || '').join(' ')).slice(0, 16000);
  `;
}

function buildInspectExpression(platform) {
  return `(() => {
    ${sharedSource()}
    const platform = ${JSON.stringify(platform)};
    const fields = {};
    const addField = (name, label, element) => { if (element && visible(element)) fields[name] = { label, type: element.tagName.toLowerCase(), valuePresent: !!clean(element.value || element.textContent) }; };
    if (platform === 'douyin') {
      addField('title', '作品标题', firstVisible('input[placeholder*="作品标题"]'));
      addField('description', '作品描述', firstVisible('[contenteditable=true].zone-container,[contenteditable=true][class*=editor]'));
      addField('collection', '合集', firstVisible('.select-collection-nkL6sA'));
      addField('visibility', '谁可以看', firstVisible('label.radio-d4zkru'));
      addField('schedule', '发布时间', all('label.radio-d4zkru').find(element => /定时发布/.test(textOf(element))));
    } else if (platform === 'bilibili') {
      addField('title', '稿件标题', firstVisible('input[placeholder="请输入稿件标题"]'));
      addField('partition', '分区', firstVisible('.video-human-type .select-controller'));
      addField('tags', '标签', firstVisible('input[placeholder*="创建标签"]'));
      addField('description', '简介', firstVisible('.ql-editor[contenteditable=true]'));
      addField('collection', '合集', firstVisible('.season-enter'));
      addField('schedule', '定时发布', all('label,div').find(element => visible(element) && textOf(element) === '定时发布'));
    } else {
      addField('description', '视频描述', firstVisible('.post-desc-box [contenteditable],.input-editor[contenteditable],.post-desc-box textarea'));
      addField('title', '短标题', firstVisible('input[placeholder*="短标题"]'));
      addField('topic', '话题', firstVisible('.finder-tag-wrap.btn'));
      addField('collection', '合集', firstVisible('.post-album-display'));
      addField('schedule', '定时发表', all('label').find(element => visible(element) && textOf(element) === '定时'));
    }
    const loginRequired = (/扫码登录|手机号登录|验证码登录|请登录|微信扫码/.test(body) || location.pathname.includes('/login') || location.hostname.startsWith('passport.')) && !Object.keys(fields).length;
    const progressTexts = all('progress,[role=progressbar],[class*=progress],[class*=upload]').filter(visible).map(element => clean(element.getAttribute('aria-valuenow') || element.value || element.textContent));
    const progressMatch = progressTexts.join(' ').match(/(100|\\d{1,2}(?:\\.\\d+)?)%/);
    const progress = Object.keys(fields).length && progressMatch ? Number(progressMatch[1]) : null;
    let uploadStage = 'idle';
    if (/上传失败|转码失败|处理失败/.test(body)) uploadStage = 'failed';
    else if (/转码中|处理中|合成中|审核素材/.test(body)) uploadStage = 'processing';
    else if (progress !== null && progress < 100) uploadStage = 'uploading';
    else if (/上传中|正在上传|上传进度/.test(body)) uploadStage = 'uploading';
    else if (/上传成功|上传完成|转码完成/.test(body) || progress === 100) uploadStage = 'uploaded';
    const formReady = !!fields.title && (platform === 'bilibili' ? !!fields.tags : !!fields.description);
    const publishTexts = platform === 'bilibili' ? ['立即投稿','投稿'] : platform === 'wechat' ? ['发表'] : ['发布'];
    const publishButtons = all(platform === 'bilibili' ? 'button,[role=button],.submit-add' : 'button,[role=button]').filter(element => visible(element) && publishTexts.includes(textOf(element)) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(clean(element.className)));
    const hasVideo = all('video').some(element => !!(element.currentSrc || element.getAttribute('src'))) || /上传成功|上传完成|转码完成/.test(body) || progress === 100;
    const videoIdentity = all('video').map(element => element.currentSrc || element.getAttribute('src') || '').filter(Boolean).join('|');
    const readyToPublish = publishButtons.length === 1 && formReady && fields.title?.valuePresent && hasVideo && !loginRequired && !['uploading','processing','failed'].includes(uploadStage);
    const fingerprint = JSON.stringify(all('input:not([type=password]):not([type=file]),textarea,[contenteditable],select,video,img').filter(visible).map(element => [element.tagName, element.value || element.textContent || '', element.checked || false, element.currentSrc || element.getAttribute('src') || '']));
    const visibleCandidates = all('[role=option],[class*=option],[class*=dropdown] li').filter(visible).map(element => ({ id: element.getAttribute('data-value') || element.getAttribute('data-id') || '', name: textOf(element).slice(0, 160) })).filter(item => item.name).slice(0, 100);
    const options = visibleCandidates.length ? { visibleCandidates: { label: '当前展开候选', values: visibleCandidates } } : {};
    const status = loginRequired ? '等待你在 Edge 扫码登录' : uploadStage === 'uploading' ? 'Edge 正在真实上传' : uploadStage === 'processing' ? '平台正在处理/转码' : readyToPublish ? '真实投稿页已就绪，等待最终人工确认' : Object.keys(fields).length ? '真实投稿表单已连接' : 'Edge 页面已连接，等待操作';
    return { pathname: location.pathname, loginRequired, progress, uploadStage, status, fields, options, readyToPublish, formReady, hasVideo, fingerprint, videoIdentity, uploadToken: window.__blockcastUploadToken || '' };
  })()`;
}

function buildProbeExpression(platform, probeGroup = '') {
  return `(async () => {
    ${sharedSource()}
    const platform = ${JSON.stringify(platform)};
    const probeGroup = ${JSON.stringify(probeGroup)};
    const result = {};
    const dedupe = values => [...new Map(values.filter(item => item && item.name).map(item => [String(item.id || '') + '\\u0000' + item.name, item])).values()];
    const titleInput = firstVisible('input[placeholder*="标题"],input[placeholder*="稿件标题"],input[placeholder*="短标题"]');
    const closeLayer = async () => { if (titleInput) { titleInput.focus(); titleInput.click(); await new Promise(resolve => setTimeout(resolve, 150)); } };
    const clickAndWait = async element => { if (!element) return false; await closeLayer(); element.scrollIntoView({ block: 'center' }); element.click(); await new Promise(resolve => setTimeout(resolve, 550)); return true; };
    const numericReactKey = element => {
      const queue = Object.getOwnPropertyNames(element).filter(key => /^__react/i.test(key)).map(key => ({ value: element[key], depth: 0 }));
      const seen = new WeakSet();
      while (queue.length) {
        const { value, depth } = queue.shift();
        if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue;
        seen.add(value);
        if (typeof value.key === 'string' && /^\\d{6,}$/.test(value.key)) return value.key;
        for (const key of ['child','sibling','return','pendingProps','memoizedProps','props','children']) {
          const child = value[key]; if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
        }
      }
      return '';
    };
    const findNamedRecords = (root, wanted) => {
      const found = []; const seen = new WeakSet(); let visits = 0;
      const walk = (value, depth) => {
        if (!value || typeof value !== 'object' || seen.has(value) || depth > 10 || visits++ > 25000) return;
        seen.add(value); let entries; try { entries = Object.entries(value).slice(0, 250); } catch { return; }
        const record = Object.fromEntries(entries.filter(([, child]) => ['string','number','boolean'].includes(typeof child)));
        const name = clean(record.title || record.name || record.label);
        if (name && (!wanted || wanted.test(name))) found.push({ name, id: String(record.seasonId || record.collectionId || record.albumId || record.id || record.value || ''), raw: record });
        for (const [key, child] of entries) if (!/token|cookie|secret|password|sign|session|csrf|avatar|url/i.test(key) && child && typeof child === 'object') walk(child, depth + 1);
      };
      walk(root, 0); return dedupe(found.map(({ name, id }) => ({ name, id })));
    };
    if (platform === 'douyin') {
      const collection = firstVisible('.select-collection-nkL6sA');
      if (await clickAndWait(collection)) {
        const values = all('.semi-select-option.collection-option').filter(visible).map(element => ({ name: textOf(element.querySelector('.option-title-WKxxu3') || element).replace(/共\\d+个作品.*/, '').trim(), id: numericReactKey(element) }));
        result.collection = { label: '账号合集', values: dedupe(values) };
      }
      await closeLayer();
      const topics = all('*').filter(element => visible(element) && element.childElementCount === 0 && /^#[^#\\s]{1,30}$/.test(textOf(element))).map(element => ({ id: textOf(element).slice(1), name: textOf(element).slice(1) }));
      result.topic = { label: '页面推荐话题', values: dedupe(topics).slice(0, 80) };
    } else if (platform === 'bilibili') {
      const partition = firstVisible('.video-human-type .select-controller');
      const partitionValues = [];
      if (!probeGroup || probeGroup === 'partition') {
        // Current human_type2 categories are a different ID space from legacy tid.
        // Use only categories actually offered by this account's current control.
        if (await clickAndWait(partition)) {
          const visibleNames = all('.drop-list-v2-item').filter(visible).map(element => element.getAttribute('title') || textOf(element.querySelector('.item-cont-main') || element));
          try {
            const response = await fetch('/x/vupre/web/archive/human/type2/list', { credentials: 'include', signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error('当前分类接口不可用');
            const json = await response.json();
            for (const item of json.data?.type_list || []) if (item.id && visibleNames.includes(clean(item.name))) partitionValues.push({ id: String(item.id), name: clean(item.name) });
          } catch {}
          await closeLayer();
        }
        if (!partitionValues.length) {
        try {
          const response = await fetch('/x/vupre/web/archive/pre', { credentials: 'include', signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('分区接口不可用');
          const json = await response.json();
          for (const parent of json.data?.typelist || []) {
            if (parent.show === false || !parent.name) continue;
            const children = (parent.children || []).filter(child => child.show !== false && child.name);
            if (!children.length) partitionValues.push({ id: String(parent.id || ''), name: clean(parent.name) });
            for (const child of children) partitionValues.push({ id: String(child.id || ''), name: clean(parent.name) + ' / ' + clean(child.name) });
          }
        } catch {}
        }
        if (!partitionValues.length && await clickAndWait(partition)) {
          for (const element of all('.drop-list-v2-item').filter(visible)) {
            const name = element.getAttribute('title') || textOf(element.querySelector('.item-cont-main') || element);
            if (name) partitionValues.push({ id: name, name });
          }
        }
      }
      if (!probeGroup || probeGroup === 'partition') result.partition = { label: '真实平台分区', values: dedupe(partitionValues) };
      await closeLayer();
      const seasonRoot = firstVisible('.video-season');
      const vue = seasonRoot && Object.getOwnPropertyNames(seasonRoot).find(key => key === '__vue__');
      let collections = [];
      if ((!probeGroup || probeGroup === 'collection') && vue) {
        const queue = [seasonRoot[vue]]; const seenComponents = new Set();
        for (let index = 0; index < queue.length && index < 120; index += 1) {
          const component = queue[index]; if (!component || seenComponents.has(component)) continue; seenComponents.add(component);
          queue.push(...(component.$children || []));
          const containers = [component._props, component._data, component.$options?.propsData, component.$options?._parentVnode?.componentOptions?.propsData].filter(Boolean);
          for (const container of containers) for (const [key, value] of Object.entries(container)) if (/season/i.test(key) && Array.isArray(value)) for (const item of value) {
            if (!item || typeof item !== 'object') continue;
            const name = clean(item.title || item.name || item.label); const id = String(item.seasonId || item.id || item.value || '');
            if (name && id) collections.push({ name, id });
          }
        }
        collections = dedupe(collections);
      }
      collections = collections.filter(item => item.id && !/^archive_id_/.test(item.id) && !/请选择|加入合集/.test(item.name));
      if ((!probeGroup || probeGroup === 'collection') && !collections.length) {
        const seasonControl = firstVisible('.season-enter');
        if (await clickAndWait(seasonControl)) collections = all('.season-item').filter(visible).map(element => ({ id: '', name: textOf(element) }));
      }
      if (!probeGroup || probeGroup === 'collection') result.collection = { label: '账号合集', values: dedupe(collections) };
      await closeLayer();
      if (!probeGroup || probeGroup === 'topic') {
        const visibleTopics = all('.hot-tag-item,.topic-tag-name').filter(visible).map(element => ({ id: textOf(element), name: textOf(element) }));
        result.topic = { label: '平台话题', values: dedupe(visibleTopics).slice(0, 120) };
      }
    } else {
      const collectionRoot = firstVisible('.post-album-wrap');
      const vueKey = collectionRoot && Object.getOwnPropertyNames(collectionRoot).find(key => key === '__vue__');
      let collections = [];
      if (vueKey) {
        const list = collectionRoot[vueKey]?._data?.dataList || [];
        collections = list.map(item => ({ id: String(item.id || ''), name: clean(item.name) })).filter(item => item.name);
      }
      if (!collections.length) {
        const collectionControl = firstVisible('.post-album-display');
        if (await clickAndWait(collectionControl)) collections = all('.option-item').filter(visible).map(element => ({ id: '', name: textOf(element).replace(/共\\d+个内容.*/, '').trim() }));
      }
      result.collection = { label: '账号合集', values: dedupe(collections) };
      await closeLayer();
      const topics = all('.hl.topic').filter(visible).map(element => ({ id: textOf(element).replace(/^#/, ''), name: textOf(element).replace(/^#/, '') })).filter(item => item.name);
      result.topic = { label: '输入时由平台实时确认', values: dedupe(topics).slice(0, 100) };
    }
    return result;
  })()`;
}

function buildFillExpression(platform, payload) {
  return `(async () => {
    ${sharedSource()}
    const platform = ${JSON.stringify(platform)};
    const payload = ${JSON.stringify(payload)};
    const results = [];
    const choiceName = value => clean(value && typeof value === 'object' ? value.name : value);
    const record = (field, ok, detail = {}) => results.push({ field, ok, ...detail });
    const nativeSet = (element, value) => {
      if (!element || !value) return false;
      element.focus();
      if (element.isContentEditable) {
        element.textContent = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } else {
        const view = element.ownerDocument.defaultView;
        const prototype = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        setter ? setter.call(element, value) : (element.value = value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    };
    const setField = async (field, selector, value) => {
      if (!value) return;
      const candidates = all(selector).filter(visible);
      if (candidates.length !== 1) return record(field, false, { reason: candidates.length ? '控件不唯一' : '未找到控件', count: candidates.length });
      nativeSet(candidates[0], value);
      await new Promise(resolve => setTimeout(resolve, 200));
      record(field, clean(candidates[0].value || candidates[0].textContent) === clean(value), { label: field, reason: '请核对平台保留的内容与长度限制' });
    };
    const clickText = async (selector, wanted, field) => {
      if (!wanted) return;
      const candidates = all(selector).filter(element => visible(element) && textOf(element) === wanted);
      if (candidates.length !== 1) return record(field, false, { reason: candidates.length ? '候选不唯一' : '当前真实候选中不存在', count: candidates.length });
      candidates[0].click(); await new Promise(resolve => setTimeout(resolve, 180));
      const selected = candidates[0].matches('[aria-checked=true],[aria-selected=true]') || candidates[0].querySelector('input:checked,[aria-checked=true]');
      record(field, !!selected, { label: wanted, reason: selected ? undefined : '已点击，请在真实平台页确认选择结果' });
    };
    if (platform === 'douyin') {
      await setField('title', 'input[placeholder*="作品标题"]', payload.title);
      await setField('description', '[contenteditable=true].zone-container,[contenteditable=true][class*=editor]', payload.description);
      const collection = choiceName(payload.collection);
      const alreadySelected = textOf(firstVisible('.select-collection-nkL6sA .selected-item-title-ebAmMX')) === collection;
      if (collection && alreadySelected) record('collection', true, { label: collection, id: payload.collection?.id });
      if (collection && !alreadySelected) {
        const control = firstVisible('.select-collection-nkL6sA');
        if (!control) record('collection', false, { reason: '未找到合集控件' });
        else { control.click(); await new Promise(resolve => setTimeout(resolve, 300)); const option = all('.semi-select-option.collection-option').filter(visible).find(element => textOf(element.querySelector('.option-title-WKxxu3') || element) === collection); if (option) { option.click(); record('collection', true, { label: collection, id: payload.collection?.id || '' }); } else record('collection', false, { reason: '当前账号合集候选中不存在' }); }
      }
      if (payload.visibility) await clickText('label.radio-d4zkru', payload.visibility, 'visibility');
      const tagResults = [];
      for (const tag of payload.tags || []) {
        const candidate = all('*').filter(element => visible(element) && element.childElementCount === 0 && textOf(element) === '#' + tag)[0];
        if (candidate) { candidate.click(); tagResults.push(tag); }
      }
      if ((payload.tags || []).length) record('tags', tagResults.length === payload.tags.length, { label: tagResults.join('、'), reason: tagResults.length === payload.tags.length ? undefined : '部分话题不在平台实时候选中' });
      if (payload.scheduleAt) {
        const label = all('label.radio-d4zkru').find(element => visible(element) && textOf(element) === '定时发布');
        if (label) { label.click(); await new Promise(resolve => setTimeout(resolve, 200)); const date = all('input').find(element => visible(element) && (/date|time/.test(element.type) || /时间|日期/.test(element.placeholder || ''))); if (date) { nativeSet(date, payload.scheduleAt.replace('T', ' ')); record('schedule', true); } else record('schedule', false, { reason: '定时控件格式需在平台页确认' }); } else record('schedule', false, { reason: '未找到定时发布控件' });
      }
      if (payload.partition) record('partition', false, { reason: '抖音视频投稿页没有分区字段' });
    } else if (platform === 'bilibili') {
      await setField('title', 'input[placeholder="请输入稿件标题"]', payload.title);
      await setField('description', '.ql-editor[contenteditable=true]', payload.description);
      const hasTag = tag => all('#tag-container .label-item-v2-content,#tag-container .tag-item,#tag-container .tag-name,.tag-container .tag-item').some(element => textOf(element).replace(/[×✕]$/, '').trim() === tag);
      for (const tag of payload.tags || []) {
        if (hasTag(tag)) { record('tags', true, { label: tag }); continue; }
        const input = firstVisible('input[placeholder*="创建标签"]');
        if (!input) { record('tags', false, { reason: '未找到标签控件' }); break; }
        nativeSet(input, tag); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); await new Promise(resolve => setTimeout(resolve, 120));
        const ok = hasTag(tag); record('tags', ok, { label: tag, reason: ok ? undefined : '平台未确认该标签节点' });
      }
      const partition = choiceName(payload.partition);
      if (partition) {
        const parts = partition.split('/').map(clean).filter(Boolean); const control = firstVisible('.video-human-type .select-controller');
        if (!control) record('partition', false, { reason: '未找到分区控件' }); else {
          control.click(); await new Promise(resolve => setTimeout(resolve, 300));
          let item = all('.drop-list-v2-item').filter(visible).find(element => (element.getAttribute('title') || textOf(element.querySelector('.item-cont-main') || element)) === parts[0]);
          if (item && parts[1]) { item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); await new Promise(resolve => setTimeout(resolve, 180)); item = all('.drop-list-v2-item').filter(visible).find(element => (element.getAttribute('title') || textOf(element.querySelector('.item-cont-main') || element)) === parts[1]); }
          if (item) { item.click(); await new Promise(resolve => setTimeout(resolve, 180)); record('partition', true, { label: partition, id: payload.partition?.id || '' }); } else record('partition', false, { reason: '当前真实分区候选中不存在' });
        }
      }
      const collection = choiceName(payload.collection);
      const alreadySelected = textOf(firstVisible('.season-enter')) === collection;
      if (collection && alreadySelected) record('collection', true, { label: collection, id: payload.collection?.id });
      if (collection && !alreadySelected) {
        const control = firstVisible('.season-enter'); if (!control) record('collection', false, { reason: '未找到合集控件' }); else { control.click(); await new Promise(resolve => setTimeout(resolve, 300)); const item = all('.season-item').filter(visible).find(element => textOf(element) === collection || textOf(element.querySelector('.season-item-title') || element) === collection); if (item) { item.click(); record('collection', true, { label: collection, id: payload.collection?.id || '' }); } else record('collection', false, { reason: '当前账号合集候选中不存在' }); }
      }
      if (payload.scheduleAt) record('schedule', false, { reason: 'B站定时控件需在真实页展开后人工确认时间范围' });
      if (payload.visibility) record('visibility', false, { reason: 'B站当前投稿页未显示独立可见性字段' });
    } else {
      await setField('title', 'input[placeholder*="短标题"]', payload.title);
      await setField('description', '.post-desc-box [contenteditable],.post-desc-box textarea', payload.description);
      const collection = choiceName(payload.collection);
      const alreadySelected = textOf(firstVisible('.post-album-display')) === collection;
      if (collection && alreadySelected) record('collection', true, { label: collection, id: payload.collection?.id });
      if (collection && !alreadySelected) {
        const control = firstVisible('.post-album-display'); if (!control) record('collection', false, { reason: '未找到合集控件' }); else { control.click(); await new Promise(resolve => setTimeout(resolve, 300)); const item = all('.option-item').filter(visible).find(element => textOf(element).startsWith(collection)); if (item) { item.click(); record('collection', true, { label: collection, id: payload.collection?.id || '' }); } else record('collection', false, { reason: '当前账号合集候选中不存在' }); }
      }
      const selectedTags = [];
      if ((payload.tags || []).length) {
        const topicControl = firstVisible('.finder-tag-wrap.btn'); if (topicControl) { topicControl.click(); await new Promise(resolve => setTimeout(resolve, 300)); for (const tag of payload.tags) { const item = all('[class*=topic],[class*=tag] [class*=item],[class*=option]').filter(visible).find(element => textOf(element).replace(/^#/, '') === tag); if (item) { item.click(); selectedTags.push(tag); await new Promise(resolve => setTimeout(resolve, 80)); } } }
        record('tags', selectedTags.length === payload.tags.length, { label: selectedTags.join('、'), reason: selectedTags.length === payload.tags.length ? undefined : '部分话题不在平台实时候选中' });
      }
      if (payload.scheduleAt) { const label = all('label').find(element => visible(element) && textOf(element) === '定时'); if (label) { label.click(); record('schedule', false, { reason: '已展开定时控件，请在真实页确认时间' }); } else record('schedule', false, { reason: '未找到定时控件' }); }
      if (payload.partition) record('partition', false, { reason: '视频号投稿页没有分区字段' });
      if (payload.visibility) record('visibility', false, { reason: '视频号当前投稿页未显示独立可见性字段' });
    }
    // Click acknowledgement alone is not evidence that the platform retained a choice.
    await new Promise(resolve => setTimeout(resolve, 250));
    for (const item of results.filter(item => item.ok && ['collection','partition','schedule'].includes(item.field))) {
      let confirmed = false;
      if (item.field === 'collection') {
        const selector = platform === 'douyin' ? '.select-collection-nkL6sA .selected-item-title-ebAmMX' : platform === 'bilibili' ? '.season-enter' : '.post-album-display';
        const selected = textOf(firstVisible(selector));
        confirmed = selected === choiceName(payload.collection);
        if (platform === 'bilibili') {
          const selectedId = firstVisible('.video-basic-wrp')?.__vue__?._data?.seasonId;
          if (selectedId != null) confirmed = confirmed && String(selectedId) === String(payload.collection?.id);
        }
      } else if (item.field === 'partition') {
        const selected = textOf(firstVisible('.video-human-type .select-controller'));
        const parts = choiceName(payload.partition).split('/').map(clean).filter(Boolean);
        const selectedId = firstVisible('.video-human-type')?.__vue__?._props?.value;
        confirmed = parts.length > 0 && parts.every(part => selected.includes(part)) && (selectedId == null || String(selectedId) === String(payload.partition?.id));
      }
      // Platform date widgets need a verified, platform-specific read-back.
      // Until that exists, explicitly hand the setting to the user for review.
      if (!confirmed) { item.ok = false; item.reason = '已尝试设置，但未读回确认；请在真实平台页复核'; }
    }
    return { ok: results.length > 0 && results.every(item => item.ok), results };
  })()`;
}

function buildPublishExpression(platform, expectedFingerprint) {
  const hosts = { douyin: 'creator.douyin.com', bilibili: 'member.bilibili.com', wechat: 'channels.weixin.qq.com' };
  return `(() => {
    if (location.protocol !== 'https:' || location.hostname !== ${JSON.stringify(hosts[platform])}) return { ok: false, error: '发布页面来源不匹配' };
    const state = ${buildInspectExpression(platform)};
    if (!state.readyToPublish || state.fingerprint !== ${JSON.stringify(expectedFingerprint)}) return { ok: false, error: '页面状态变化，请重新复核' };
    ${sharedSource()}
    const allowed = ${JSON.stringify(platform === 'bilibili' ? ['立即投稿','投稿'] : platform === 'wechat' ? ['发表'] : ['发布'])};
    const nodes = all(${JSON.stringify(platform === 'bilibili' ? 'button,[role=button],.submit-add' : 'button,[role=button]')}).filter(element => visible(element) && allowed.includes(textOf(element)) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(clean(element.className)));
    if (nodes.length !== 1) return { ok: false, error: '无法唯一确认发布按钮' };
    nodes[0].click();
    return { ok: true, status: 'clicked', published: false };
  })()`;
}

module.exports = { buildInspectExpression, buildProbeExpression, buildFillExpression, buildPublishExpression };
