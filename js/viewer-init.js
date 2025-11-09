// js/viewer-init.js
(function(){
  function qs(k){ return new URLSearchParams(location.search).get(k); }
  const src = qs('src');
  const audioBase = (qs('audioBase') || './audio').replace(/\/$/,'');
  const title = qs('title') || (src ? src.split('/').pop() : 'Flipbook');

  // Debug logger
  function log(...args){ console.log('[PageAudio]', ...args); }

  // set viewer title
  const titleText = document.getElementById('titleText');
  if(titleText) titleText.textContent = 'Viewing: ' + title;
  const bookEl = document.getElementById('viewer_book');
  if(src) bookEl.setAttribute('source', src);

  // ----- Audio setup -----
  let audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';
  audioEl.volume = 1.0;
  let audioCtx = null;

  async function ensureCtx(){
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended'){
      await audioCtx.resume();
      log('AudioContext resumed');
    }
  }

  async function playForPage(pageNum){
    if(!pageNum && pageNum !== 0) return;
    const url = `${audioBase}/audio-${pageNum}.mp3`;
    log('Playing for page', pageNum, '→', url);
    try{
      await ensureCtx();
      audioEl.src = url;
      const p = audioEl.play();
      if(p && p.catch) p.catch(e=>log('play() rejected:', e));
    }catch(e){
      log('playForPage error:', e);
    }
  }

  // ----- Page change detection -----
  let lastPage = null;

  // Hook into DFLIP if possible
  function attachDflipHook(){
    try{
      if(window.DFLIP && DFLIP.defaults){
        const orig = DFLIP.defaults.onPageChanged;
        DFLIP.defaults.onPageChanged = function(app){
          const p = app.currentPageNumber;
          if(typeof p !== 'undefined' && p !== lastPage){
            lastPage = p;
            log('DFLIP hook detected page', p);
            playForPage(p);
          }
          if(orig) try{ orig(app); }catch(e){}
        };
        log('Attached to DFLIP.defaults.onPageChanged');
        return true;
      }
    }catch(e){ log('attachDflipHook error', e); }
    return false;
  }

  // Fallback: poll page number every 800ms
  function startPolling(){
    setInterval(()=>{
      try{
        if(window.DFLIP && DFLIP.apps && DFLIP.apps.length){
          const app = DFLIP.apps[0];
          const p = app.currentPageNumber;
          if(typeof p !== 'undefined' && p !== lastPage){
            lastPage = p;
            log('Poll detected page', p);
            playForPage(p);
          }
        }
      }catch(e){}
    }, 800);
    log('Started polling fallback');
  }

  // Init: try hook, else poll
  setTimeout(()=>{
    if(!attachDflipHook()){
      startPolling();
    }
  }, 1200);

  // Resume audio on first user click
  document.addEventListener('click', ()=>{
    ensureCtx().catch(()=>{});
  }, {once:true});

})();
