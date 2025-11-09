// js/debug-problems.js
// Focused problems-only debugger for flipbook viewer.
// Include BEFORE other scripts in viewer.html.

(function(){
  const TIMEOUT = 6000;
  const WAIT_PLUGIN_MS = 1000;
  const REPORT_ID = 'flip-problems-report-v1';

  function mkOverlay(){
    if(document.getElementById(REPORT_ID)) return document.getElementById(REPORT_ID);
    const d = document.createElement('div');
    d.id = REPORT_ID;
    Object.assign(d.style, {
      position:'fixed', right:'12px', top:'12px', width:'380px', maxHeight:'70vh', overflow:'auto',
      background:'rgba(32,20,20,0.92)', color:'#ffdede', fontFamily:'Arial,Helvetica,sans-serif',
      fontSize:'13px', padding:'10px', borderRadius:'8px', zIndex:999999, display:'none', boxShadow:'0 8px 30px rgba(0,0,0,0.6)'
    });
    d.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="font-size:14px">Flipbook Problems</strong><button id="pr-close" style="background:#222;border:1px solid #444;color:#ffdede;padding:6px;border-radius:6px;cursor:pointer">Close</button></div><div id="pr-body"></div><div style="margin-top:8px"><button id="pr-download" style="background:#0b7cff;border:none;color:#fff;padding:8px;border-radius:6px;cursor:pointer">Download JSON</button></div>';
    document.body.appendChild(d);
    d.querySelector('#pr-close').onclick = ()=> d.style.display='none';
    return d;
  }

  async function fetchWithTimeout(url){
    const controller = new AbortController();
    const id = setTimeout(()=>controller.abort(), TIMEOUT);
    try{
      const res = await fetch(url, {signal: controller.signal});
      clearTimeout(id);
      const ct = res.headers.get('content-type') || '';
      return { url, ok: res.ok, status: res.status, ctype: ct, textSample: (ct.includes('text')||ct.includes('json')||ct.includes('javascript')? await res.text().then(t=>t.slice(0,1200)).catch(()=>null): null) };
    } catch(e){
      clearTimeout(id);
      return { url, ok:false, error: String(e) };
    }
  }

  function addProblem(list, label, info){
    list.push({label, info});
    console.warn('[Flipbook problem] ' + label, info);
  }

  async function runChecks(){
    const problems = [];
    const urlParams = new URLSearchParams(window.location.search);
    const bookParam = urlParams.get('book');

    // 1) jQuery presence & multiple copies
    const jqScripts = Array.from(document.querySelectorAll('script[src]')).filter(s=>/jquery/i.test(s.src));
    const jqVersion = window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery;
    if(!jqVersion){
      addProblem(problems, 'jQuery missing', {msg:'No window.jQuery detected. Include jQuery before dFlip/viewer-init.'});
    } else {
      if(jqScripts.length > 1) addProblem(problems, 'Multiple jQuery includes', {version: jqVersion, scripts: jqScripts.map(s=>s.src)});
      if(parseFloat(jqVersion) < 3) addProblem(problems, 'jQuery version too old', {version: jqVersion, need:'>=3.x'});
    }

    // 2) dFlip JS + CSS reachable
    const dflipJsPath = 'dflip/js/dflip.min.js';
    const dflipCssPath = 'dflip/css/dflip.min.css';
    const jsInfo = await fetchWithTimeout(dflipJsPath);
    if(!jsInfo.ok) addProblem(problems, 'dflip JS not reachable', jsInfo);
    const cssInfo = await fetchWithTimeout(dflipCssPath);
    if(!cssInfo.ok) addProblem(problems, 'dflip CSS not reachable', cssInfo);

    // 3) if dflip JS retrieved but contains HTML or looks wrong, flag
    if(jsInfo.ok && jsInfo.ctype && (jsInfo.ctype.indexOf('javascript') === -1) && jsInfo.textSample){
      addProblem(problems, 'dflip JS content-type unexpected', {ctype: jsInfo.ctype, head: jsInfo.textSample.slice(0,300)});
    }
    if(jsInfo.ok && jsInfo.textSample && jsInfo.textSample.indexOf('dFlip') === -1 && jsInfo.textSample.indexOf('flipBook')===-1){
      // heuristic: dFlip bundle should mention dFlip or flipBook
      addProblem(problems, 'dflip JS may be wrong/corrupted', {head: jsInfo.textSample.slice(0,300)});
    }

    // 4) wrap jQuery.getScript to capture dynamic loads
    const dynamicLoads = [];
    if(window.jQuery && jQuery.getScript){
      const old = jQuery.getScript;
      jQuery.getScript = function(url, cb){
        dynamicLoads.push({url, time: new Date().toISOString()});
        return old.call(this, url, cb);
      };
      // restore later by assignment after we re-load plugin
      setTimeout(()=>{ if(window.jQuery) jQuery.getScript = old; }, TIMEOUT+2000);
    }

    // 5) check $.fn.dFlip attached (wait a bit)
    await new Promise(r=>setTimeout(r, WAIT_PLUGIN_MS));
    if(!(window.jQuery && window.jQuery.fn && window.jQuery.fn.dFlip)){
      addProblem(problems, 'dFlip plugin not attached', {msg:'$.fn.dFlip is undefined even after waiting. dFlip script may have errored or dependencies missing.'});
    }

    // 6) common blank resource probe
    const blankPaths = ['/blank','blank','dflip/images/blank.png','dflip/blank','/flipbooksample/blank'];
    const blankResults = [];
    for(let p of blankPaths){ blankResults.push(await fetchWithTimeout(p)); }
    const blankOk = blankResults.some(r=>r.ok);
    if(!blankOk) addProblem(problems, 'Missing blank resource', {checked: blankResults.map(r=> ({url:r.url, ok:r.ok, status:r.status||r.error, ctype:r.ctype}))});

    // 7) If book param present -> resolve via assets/books.json if present, else assume assets/books/<id>
    const booksJson = await fetchWithTimeout('assets/books.json');
    let bookFolder = null;
    if(booksJson.ok){
      try{
        const arr = JSON.parse(booksJson.textSample || '[]');
        const entry = arr.find(b=>b.id === bookParam);
        if(entry) bookFolder = entry.folder;
      }catch(e){}
    }
    if(bookParam){
      if(!bookFolder) bookFolder = 'assets/books/' + bookParam;
      // check pages.json
      const pagesJsonUrl = bookFolder.replace(/\/$/,'') + '/pages.json';
      const pinfo = await fetchWithTimeout(pagesJsonUrl);
      if(!pinfo.ok) addProblem(problems, 'pages.json for book missing', {url: pagesJsonUrl, status: pinfo.status || pinfo.error});
      else {
        // try parse
        let pages = null;
        try{ pages = JSON.parse(pinfo.textSample || '{}'); }catch(e){ addProblem(problems, 'pages.json invalid JSON', {url: pagesJsonUrl}); }
        if(pages && Array.isArray(pages.pages) && pages.pages.length>0){
          const firstImg = (pages.basePath ? pages.basePath.replace(/\/$/,'') + '/' : bookFolder + '/images/') + pages.pages[0];
          const imgInfo = await fetchWithTimeout(firstImg);
          if(!imgInfo.ok) addProblem(problems, 'First page image missing', {url:firstImg, status: imgInfo.status || imgInfo.error});
          // check page meta
          const pageMeta = bookFolder.replace(/\/$/,'') + '/page-001.json';
          const metaInfo = await fetchWithTimeout(pageMeta);
          if(!metaInfo.ok) addProblem(problems, 'Page metadata missing (page-001.json)', {url:pageMeta, status: metaInfo.status || metaInfo.error});
          else {
            try{ const meta = JSON.parse(metaInfo.textSample || '{}'); if(meta.links && !Array.isArray(meta.links)) addProblem(problems,'page-001.json links invalid', {url:pageMeta}); }catch(e){ addProblem(problems,'page-001.json invalid JSON', {url:pageMeta}); }
          }
        } else {
          addProblem(problems, 'pages.json has no pages', {url:pagesJsonUrl});
        }
      }
    } else {
      // single-book style: assets/pages.json
      const ap = await fetchWithTimeout('assets/pages.json');
      if(!ap.ok) addProblem(problems, 'assets/pages.json missing', {url:'assets/pages.json', status: ap.status || ap.error});
      else {
        try{
          const pages = JSON.parse(ap.textSample || '{}');
          if(!pages.pages || !pages.pages.length) addProblem(problems, 'assets/pages.json empty pages list', {url:'assets/pages.json'});
          else {
            const first = (pages.basePath ? pages.basePath.replace(/\/$/,'') + '/' : 'assets/images/') + pages.pages[0];
            const fi = await fetchWithTimeout(first);
            if(!fi.ok) addProblem(problems, 'First page image (assets/pages.json) missing', {url:first, status: fi.status || fi.error});
          }
        }catch(e){ addProblem(problems, 'assets/pages.json invalid JSON', {url:'assets/pages.json'}); }
      }
    }

    // 8) dynamic loads: if we captured any, probe them and report failures
    if(typeof dynamicLoads !== 'undefined' && dynamicLoads.length){
      for(const dl of dynamicLoads){
        const inf = await fetchWithTimeout(dl.url);
        if(!inf.ok) addProblem(problems, 'Dynamic script load failed', {url: dl.url, status: inf.status || inf.error, ctype: inf.ctype});
      }
    }

    // 9) Display results if any problems
    if(problems.length){
      const panel = mkOverlay();
      const body = panel.querySelector('#pr-body');
      body.innerHTML = '';
      problems.forEach(p=>{
        const item = document.createElement('div');
        item.style = 'margin-bottom:8px;padding:8px;border-radius:6px;background:rgba(140,20,20,0.06);border:1px solid rgba(200,60,60,0.12)';
        item.innerHTML = `<div style="font-weight:600;color:#ffdede">${p.label}</div><div style="margin-top:6px;color:#ffd">${JSON.stringify(p.info)}</div>`;
        body.appendChild(item);
      });
      panel.style.display = 'block';
      // download JSON
      panel.querySelector('#pr-download').onclick = ()=>{
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({timestamp:new Date().toISOString(), problems},null,2)], {type:'application/json'}));
        a.download = 'flipbook-problems-' + (new Date().toISOString().replace(/[:.]/g,'-')) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
      };
      console.error('Flipbook problems detected:', problems);
    } else {
      console.log('No problems detected by debug-problems (quick checks).');
    }
  } // end runChecks

  // run as early as possible but after DOM minimal
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runChecks);
  else setTimeout(runChecks, 80);

})();
