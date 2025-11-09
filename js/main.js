// js/main.js — robust manifest-driven folder browser with Back button (opens viewer.html)
(function(){
  // --- DOM refs (minimal HTML assumed) ---
  const inlineHolder = document.getElementById('inlineHolder');
  const audioBaseInput = document.getElementById('audioBase');

  // --- Debug panel ---
  function ensureDebugPanel(){
     }
  function dbg(msg){
    
  }

  // --- Utilities ---
  function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function looksLikeLocalFile(u){
    if(!u) return false;
    if(/^file:\/\//i.test(u)) return true;
    if(/^[a-zA-Z]:\\/.test(u)) return true;
    return false;
  }
  function buildViewerUrl(params){
    const q = new URLSearchParams(params).toString();
    return `viewer.html?${q}`;
  }

  // --- Manifest-driven directory listing (preferred) ---
  let MANIFEST_TREE = null;

  // Ensure container exists and inner wrapper exists
  function createServerTreeContainer(){
    if(document.getElementById('serverFileTree')){
      if(!document.getElementById('serverFileTreeInner')){
        const treeWrap = document.createElement('div');
        treeWrap.id = 'serverFileTreeInner';
        document.getElementById('serverFileTree').appendChild(treeWrap);
      }
      return;
    }

    const container = document.createElement('div');
    container.id = 'serverFileTree';
    container.style = 'margin-top:12px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:transparent;border-radius:10px;max-height:70vh;overflow:auto;';
    const title = document.createElement('div');
    title.style = 'font-weight:700;margin-bottom:6px;color:var(--title-color,#e6eef8)';
    title.textContent = 'Folders';
    container.appendChild(title);
    const note = document.createElement('div');
    note.style = 'font-size:12px;color:#bcd9ff;margin-bottom:8px';
    note.textContent = 'Click a chapter to open it in the viewer.';
    container.appendChild(note);
    const treeWrap = document.createElement('div');
    treeWrap.id = 'serverFileTreeInner';
    container.appendChild(treeWrap);

    const ref = inlineHolder || document.querySelector('.card') || document.body;
    if(ref && ref.parentNode){
      ref.parentNode.insertBefore(container, ref.nextSibling);
    } else {
      document.body.appendChild(container);
    }
  }

  // encode each path segment so spaces/special chars are safe
  function buildSafeHrefFromPath(relPath, isDir){
    if(!relPath) return './';
    const segs = relPath.split('/').map(s => encodeURIComponent(s));
    let href = './' + segs.join('/');
    if(isDir && !href.endsWith('/')) href += '/';
    return href;
  }

  // parse auto-index HTML anchors (fallback)
  function parseIndexHtml(html, basePath = './'){
    try{
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      const items = anchors
        .map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim() }))
        .filter(i => i.href && i.href !== '../' && !i.href.startsWith('http'))
        .map(i => {
          const isDir = i.href.endsWith('/');
          return {
            name: decodeURIComponent(i.text.replace(/\/$/, '')),
            href: (basePath + i.href).replace(/\/\.\//g,'/'),
            isDir
          };
        });
      return items;
    }catch(e){
      dbg('parseIndexHtml error: ' + e);
      return [];
    }
  }

  // ---- renderServerList with Back button ----
  // parentPath should be the manifest path for current folder (e.g., "Class 1/EVS")
  function renderServerList(items, breadcrumbText = '', parentPath = ''){
    createServerTreeContainer();
    const wrap = document.getElementById('serverFileTreeInner');
    if(!wrap){
      dbg('renderServerList: container missing');
      return;
    }
    wrap.innerHTML = '';

    // Header: breadcrumb + optional Back button
    const headerBar = document.createElement('div');
    headerBar.style = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;';

    const bc = document.createElement('div');
    bc.style = 'font-size:13px;color:#bcd9ff;flex:1';
    bc.textContent = breadcrumbText || 'Home';
    headerBar.appendChild(bc);

    if(parentPath && parentPath.trim() !== ''){
      const backBtn = document.createElement('button');
      backBtn.textContent = '← Back';
      backBtn.style = 'padding:6px 10px;background:linear-gradient(90deg,#2563eb,#38bdf8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:13px';
      backBtn.addEventListener('click', ()=>{
        dbg('Back button clicked (parentPath=' + parentPath + ')');
        const parts = parentPath.split('/').filter(Boolean);
        parts.pop(); // go up one level
        const upPath = parts.join('/');
        if(MANIFEST_TREE){
          // if upPath is empty -> render root
          if(!upPath) {
            const root = MANIFEST_TREE;
            const topItems = (root.children || []).map(c => ({
              name: c.name,
              path: c.path,
              isDir: c.type === 'dir',
              href: c.type === 'dir' ? buildSafeHrefFromPath(c.path, true) : buildSafeHrefFromPath(c.path, false)
            }));
            renderServerList(topItems, root.name || '', '');
          } else {
            renderChildrenFromManifest(upPath);
          }
        } else {
          // fallback: just fetch root directory listing
          fetchDirectory('./');
        }
      });
      headerBar.appendChild(backBtn);
    }

    wrap.appendChild(headerBar);

    if(!items || !items.length){
      wrap.textContent = 'No items to show.';
      return;
    }

    const ul = document.createElement('ul');
    ul.style = 'margin:0;padding:0;list-style:none;';

    items.forEach(it => {
      const li = document.createElement('li');
      li.style = 'display:flex;align-items:center;justify-content:space-between;padding:8px;border-radius:8px;margin-bottom:6px;background:linear-gradient(180deg,rgba(255,255,255,0.02),transparent);';
      const a = document.createElement('a');

      const fileHref = it.href || (it.isDir ? buildSafeHrefFromPath(it.path, true) : buildSafeHrefFromPath(it.path, false));
      a.href = fileHref;
      a.textContent = it.name; // folder slash removed for clean look
      a.style = 'flex:1;color:#e6eef8;text-decoration:none;font-weight:' + (it.isDir ? '700' : '500') + ';';
      a.addEventListener('click', (ev)=>{
        ev.preventDefault();
        if(it.isDir){
          dbg('Folder clicked: ' + (it.path || it.href));
          if(MANIFEST_TREE){
            renderChildrenFromManifest(it.path || it.href);
          } else {
            fetchDirectory(a.getAttribute('href'));
          }
        } else {
          dbg('Opening in viewer: ' + fileHref);
          const audioBase = (audioBaseInput && audioBaseInput.value.trim()) ? audioBaseInput.value.trim() : './audio';
          try{
            const vurl = buildViewerUrl({ src: fileHref, audioBase, title: it.name, isBlob: '0' });
            window.open(vurl, '_blank');
          }catch(e){
            dbg('Failed to open viewer URL: ' + e);
          }
        }
      });

      li.appendChild(a);

      if(!it.isDir){
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.style = 'margin-left:10px;padding:6px 10px;border-radius:8px;border:0;background:linear-gradient(90deg,#0ea5a4,#06b6d4);color:#041f24;cursor:pointer';
        openBtn.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          dbg('Open button: ' + fileHref);
          const audioBase = (audioBaseInput && audioBaseInput.value.trim()) ? audioBaseInput.value.trim() : './audio';
          try{
            const vurl = buildViewerUrl({ src: fileHref, audioBase, title: it.name, isBlob: '0' });
            window.open(vurl, '_blank');
          }catch(e){ dbg('openBtn error: ' + e); }
        });
        li.appendChild(openBtn);
      }

      ul.appendChild(li);
    });

    wrap.appendChild(ul);
  }

  // Find node in manifest by path
  function findNodeByPath(node, relPath){
    if(!relPath || relPath === '' || relPath === '.' ) return node;
    const parts = relPath.split('/').filter(Boolean);
    let cur = node;
    for(const p of parts){
      if(!cur.children) return null;
      const match = cur.children.find(c => c.name === p || c.path === (cur.path ? (cur.path + '/' + p) : p));
      if(!match) return null;
      cur = match;
    }
    return cur;
  }

  // Render children for a manifest node
  function renderChildrenFromManifest(relPath){
    if(!MANIFEST_TREE) return;
    const node = findNodeByPath(MANIFEST_TREE, relPath);
    if(!node){
      dbg('Manifest node not found: ' + relPath);
      const wrap = document.getElementById('serverFileTreeInner');
      if(wrap) wrap.textContent = 'Folder not found in manifest: ' + relPath;
      return;
    }
    const items = (node.children || []).map(c => ({
      name: c.name,
      path: c.path,
      isDir: c.type === 'dir',
      href: c.type === 'dir' ? buildSafeHrefFromPath(c.path, true) : buildSafeHrefFromPath(c.path, false)
    }));
    renderServerList(items, (node.path || node.name), node.path || '');
  }

  // init: try manifest first then fallback to server index HTML
  async function initDirectoryListingInternal(){
    createServerTreeContainer();
    try{
      dbg('Loading manifest file-list.json');
      const m = await fetch('./file-list.json', { cache: 'no-store' });
      if(m.ok){
        const json = await m.json();
        MANIFEST_TREE = json;
        dbg('Manifest loaded — rendering root.');
        const topItems = (json.children || []).map(c => ({
          name: c.name,
          path: c.path,
          isDir: c.type === 'dir',
          href: c.type === 'dir' ? buildSafeHrefFromPath(c.path, true) : buildSafeHrefFromPath(c.path, false)
        }));
        renderServerList(topItems, json.name || '', '');
        return;
      }
      dbg('file-list.json not present (status ' + m.status + '), falling back to server index');
    }catch(e){
      dbg('Manifest load error: ' + e);
    }

    // fallback to server directory index
    try{
      dbg('Attempting to fetch directory index ./');
      const r = await fetch('./', { cache: 'no-store' });
      if(!r.ok) throw new Error('Bad status: ' + r.status);
      const html = await r.text();
      const anchors = parseIndexHtml(html, './');
      if(anchors && anchors.length){
        renderServerList(anchors, 'Index', './');
        return;
      }
      throw new Error('No anchors parsed from server index');
    }catch(err){
      dbg('Directory fetch failed: ' + err);
      const wrap = document.getElementById('serverFileTreeInner');
      if(wrap) wrap.textContent = 'No manifest and directory listing disabled. Put file-list.json or enable directory index.';
    }
  }

  // fallback helper to fetch server directory HTML when manifest absent
  async function fetchDirectory(relPath = './'){
    try{
      dbg('Fetching directory HTML: ' + relPath);
      let req = relPath;
      if(!req.endsWith('/')) req += '/';
      const r = await fetch(req, { cache: 'no-store' });
      dbg('HTTP ' + r.status + ' for ' + req);
      if(!r.ok) throw new Error('Bad status ' + r.status);
      const html = await r.text();
      const items = parseIndexHtml(html, req);
      if(items && items.length){
        // parentPath: strip leading ./ if present, and trailing slash
        let parentPath = req.replace(/^\.\//,'').replace(/\/$/,'');
        renderServerList(items, parentPath || 'Index', parentPath);
        return;
      }
      throw new Error('No anchors parsed');
    }catch(err){
      dbg('fetchDirectory error: ' + err);
      const wrap = document.getElementById('serverFileTreeInner') || (createServerTreeContainer() && document.getElementById('serverFileTreeInner'));
      if(wrap) wrap.textContent = 'Failed to fetch directory: ' + err;
    }
  }

  // --- Embedding & audio helpers (optional) ---
  function embedInlineSrc(src, title){
    const audioBase = (audioBaseInput && audioBaseInput.value.trim()) ? audioBaseInput.value.trim() : './audio';
    if(!inlineHolder) return;
    inlineHolder.innerHTML = `
      <div class="embedCard">
        <div class="embedHeader"><strong>Embedded Flipbook:</strong> ${esc(title)}</div>
        <div id="df_inline_container"><div class="_df_book" id="df_inline_book" source="${esc(src)}"></div></div>
      </div>
    `;
    dbg('Embedded flipbook source: ' + src);
    ensureJQueryThenReloadDflip(()=> {
      try{
        if(window.DFLIP && DFLIP.defaults){
          DFLIP.defaults.onPageChanged = function(app){
            dbg('Page changed (inline) to: ' + app.currentPageNumber);
            playAudioInline(audioBase, app.currentPageNumber);
          };
        }
      }catch(e){ dbg('attach inline hook error: ' + e); }
    });
  }

  let currentAudio = null;
  function stopAudio(){
    if(currentAudio){
      try{ currentAudio.pause(); currentAudio.currentTime = 0; }catch(e){}
      currentAudio = null;
      dbg('Stopped audio');
    }
  }
  async function checkAudioExists(url){
    dbg('HEAD check audio: ' + url);
    try{
      const res = await fetch(url, { method: 'HEAD' });
      dbg('HEAD status: ' + res.status);
      return res.ok;
    }catch(e){
      dbg('HEAD failed, trying small GET: ' + e);
      try{
        const r2 = await fetch(url, { method:'GET', headers:{ Range:'bytes=0-1' } });
        dbg('Range GET status: ' + r2.status);
        return r2.ok;
      }catch(e2){
        dbg('Range GET failed: ' + e2);
        return false;
      }
    }
  }
  async function playAudioInline(base, pageNum){
    stopAudio();
    let b = base || './audio';
    if(b.endsWith('/')) b = b.slice(0,-1);
    const audioUrl = `${b}/audio-${pageNum}.mp3`;
    const ok = await checkAudioExists(audioUrl);
    if(!ok){ dbg('Audio missing: ' + audioUrl); return; }
    currentAudio = new Audio(audioUrl);
    currentAudio.preload = 'auto';
    try{
      await currentAudio.play().catch(()=>{ dbg('play promise rejected'); });
    }catch(e){ dbg('Audio play error: ' + e); }
  }

  // load dflip scripts (used for embedding if required)
  function ensureJQueryThenReloadDflip(cb){
    if(!window.jQuery){
      const s = document.createElement('script');
      s.src = 'dflip/js/libs/jquery.min.js';
      s.onload = ()=> reloadDflip(cb);
      s.onerror = ()=> dbg('Failed to load jquery');
      document.body.appendChild(s);
    } else {
      reloadDflip(cb);
    }
  }
  function reloadDflip(cb){
    document.querySelectorAll('script[data-dflip]').forEach(s => s.remove());
    const s = document.createElement('script');
    s.src = 'dflip/js/dflip.min.js';
    s.setAttribute('data-dflip','1');
    s.onload = cb || function(){};
    s.onerror = ()=> dbg('Failed to load dflip');
    document.body.appendChild(s);
  }

  window.addEventListener('beforeunload', ()=> { stopAudio(); dbg('Unloading — stopped audio'); });

  // enable-audio UI: try to find any button in DOM (many HTML variants) then attach behavior
  (function attachEnableAudio(){
    const btn = document.getElementById('enableAudioMain') || document.querySelector('[data-enable-audio]');
    if(!btn) return;
    btn.addEventListener('click', async ()=>{
      try{
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if(ctx.state === 'suspended') await ctx.resume();
        dbg('AudioContext state: ' + ctx.state);
        const tmp = new Audio();
        tmp.muted = true;
        tmp.src = (audioBaseInput && audioBaseInput.value ? audioBaseInput.value : './audio').replace(/\/$/,'') + '/audio-1.mp3';
        try{ await tmp.play().catch(()=>{}); tmp.pause(); tmp.src=''; }catch(e){ dbg('temp play failed: '+e); }
        if(btn && btn.parentNode) btn.parentNode.removeChild(btn);
        dbg('Audio unlock attempted');
      }catch(e){
        dbg('Enable audio error: ' + e);
      }
    });
  })();

  // Start after DOMContentLoaded to avoid races
  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(()=> {
      try { createServerTreeContainer(); } catch(e){ dbg('createServerTreeContainer error: ' + e); }
      initDirectoryListingInternal().catch(err => dbg('initDirectoryListing error: ' + err));
    }, 10);
  });

  dbg('main.js loaded (folder-only mode with Back button)');
})();
