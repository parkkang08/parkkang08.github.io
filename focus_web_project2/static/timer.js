(function(){
  const modeText  = document.getElementById('modeText');
  const countdown = document.getElementById('countdown');
  const elapsed   = document.getElementById('elapsed');
  const studyMin  = document.getElementById('studyMin');
  const studySec  = document.getElementById('studySec');
  const breakMin  = document.getElementById('breakMin');
  const breakSec  = document.getElementById('breakSec');
  const applyBtn  = document.getElementById('applyTimeBtn');

  const fmt=(s)=>{ s=Math.max(0,s|0); const m=String(Math.floor(s/60)).padStart(2,'0'); const n=String(s%60).padStart(2,'0'); return `${m}:${n}`; };
  const toSec=(t)=>{ const m=String(t||'').match(/(\d{1,2})\s*:\s*(\d{2})/); return m?(+m[1])*60+(+m[2]):0; };
  const getMode=()=>{ const t=modeText.textContent||''; return t.includes('휴식')?'break':(t.includes('공부')?'study':'idle'); };

  /* 게이지 */
  const gaugeWrap=document.getElementById('timeGauge'); const bar=gaugeWrap.querySelector('.bar'); const gTime=document.getElementById('gaugeTime');
  const CIRC=2*Math.PI*50; bar.style.strokeDasharray=String(CIRC); bar.style.strokeDashoffset=String(CIRC);
  let total=1, seed=0;
  function recalcTotal(){
    const m=getMode();
    if(m==='study') total=(+studyMin.value||0)*60+(+studySec.value||0);
    else if(m==='break') total=(+breakMin.value||0)*60+(+breakSec.value||0);
    else total = seed || ((+studyMin.value||0)*60+(+studySec.value||0));
    total=Math.max(1,total);
  }
  function renderGauge(){
    const remain=toSec(countdown.textContent);
    if(remain>0 && !seed){ seed=remain; if(getMode()==='idle') total=seed; }
    if(total<1) recalcTotal();
    const ratio=Math.min(1,Math.max(0,remain/total));
    bar.style.strokeDashoffset=String(CIRC*(1-ratio));
    bar.style.stroke=(ratio<=0.15)?'#ef4444':'url(#gaugeGrad)';
    gTime.textContent=fmt(remain);
  }
  const mo=new MutationObserver(renderGauge);
  mo.observe(countdown,{subtree:true,childList:true,characterData:true});
  mo.observe(modeText,{subtree:true,childList:true,characterData:true});
  [studyMin,studySec,breakMin,breakSec].forEach(el=>el.addEventListener('change',()=>{ seed=0; recalcTotal(); renderGauge(); }));
  recalcTotal(); renderGauge();

  /* === 경과 시간 잠금 === */
  const ELAPSED_LOCK = { paused:false, value:'' };
  const elObserver = new MutationObserver(()=>{
    if(ELAPSED_LOCK.paused && elapsed.textContent !== ELAPSED_LOCK.value){
      elapsed.textContent = ELAPSED_LOCK.value;
    }
  });
  elObserver.observe(elapsed,{subtree:true, childList:true, characterData:true});

  /* ===== 타이머 객체 ===== */
  const TIMER={
    running:false, paused:false, fallback:false, raf:0, phase:'study', endAt:0, startAt:0, _lastRemain:-1,
    _totalStudy(){ return Math.max(1,(+studyMin.value||0)*60+(+studySec.value||0)); },
    _totalBreak(){ return Math.max(1,(+breakMin.value||0)*60+(+breakSec.value||0)); },
    _readRemain(){ return toSec(countdown.textContent); },
    _writeRemain(s){ countdown.textContent=`남은 시간: ${fmt(s)}`; },
    _writeElapsed(ms){
      if(ELAPSED_LOCK.paused) return;
      const sec=Math.max(0, Math.floor(ms/1000));
      const h=String(Math.floor(sec/3600)).padStart(2,'0');
      const m=String(Math.floor((sec%3600)/60)).padStart(2,'0');
      const s=String(sec%60).padStart(2,'0');
      elapsed.textContent=`경과 시간: ${h}:${m}:${s}`;
    },
    _setMode(phase){
      if(phase==='study'){ modeText.textContent='모드: 공부'; modeText.classList.remove('mode-break','mode-idle'); modeText.classList.add('mode-study'); }
      else{ modeText.textContent='모드: 휴식'; modeText.classList.remove('mode-study','mode-idle'); modeText.classList.add('mode-break'); }
    },
    _startPhase(phase, fromRemain){
      this.phase=phase; this._setMode(phase);
      const tot=(phase==='study')?this._totalStudy():this._totalBreak();
      const startFrom=(fromRemain>0 && fromRemain<=tot)?fromRemain:tot;
      this.startAt=Date.now();
      this.endAt=Date.now()+startFrom*1000+999;
      this._lastRemain=-1;
      this._writeRemain(startFrom);
      document.getElementById('startSound')?.play?.().catch(()=>{});
    },
    _rafTick(){
      if(!this.running) return;
      const now = Date.now();
      const remain=Math.max(0, Math.floor((this.endAt - now)/1000));
      if(remain!==this._lastRemain){
        this._writeRemain(remain);
        this._lastRemain=remain;
      }
      if(!this.paused) this._writeElapsed(now-this.startAt);
      if(!this.paused && remain<=0){
        document.getElementById('endSound')?.play?.().catch(()=>{});
        this._startPhase(this.phase==='study'?'break':'study');
      }
      this.raf = requestAnimationFrame(()=>this._rafTick());
    },
    start(){
      const before=this._readRemain();
      setTimeout(()=>{
        const after=this._readRemain();
        this.fallback = !((after!==before) && (before>0 || after>0));
        this.running=true; this.paused=false;
        ELAPSED_LOCK.paused=false; ELAPSED_LOCK.value='';
        if(this.fallback){
          const currentMode = (getMode()==='idle')?'study':getMode();
          this._startPhase(currentMode, this._readRemain());
          cancelAnimationFrame(this.raf); this._rafTick();
        }
        updateApplyBtn();
      }, 300);
    },
    pause(){
      if(!this.running || this.paused) return;
      this.paused=true;
      ELAPSED_LOCK.paused=true; ELAPSED_LOCK.value=elapsed.textContent;
      updateApplyBtn();
    },
    resume(){
      if(!this.running || !this.paused) return;
      const tot=(this.phase==='study')?this._totalStudy():this._totalBreak();
      const remain=this._readRemain();
      this.startAt=Date.now() - (tot-remain)*1000;
      this.endAt=Date.now() + remain*1000 + 999;
      this.paused=false;
      ELAPSED_LOCK.paused=false; ELAPSED_LOCK.value='';
      updateApplyBtn();
    },
    stopAll(){
      this.running=false; this.paused=false;
      cancelAnimationFrame(this.raf); this.raf=0;
      updateApplyBtn();
    },
    resetFromCountdown(){
      if(!this.running || !this.fallback) return;
      const r=this._readRemain(); if(r>0) this.endAt=Date.now()+r*1000+999;
    }
  };

  /* 시간 적용 */
  function applyTime(e){
    if(applyBtn.disabled){ e?.preventDefault?.(); return; }
    const payload={ study:{min:+(studyMin.value||0), sec:+(studySec.value||0)}, rest:{min:+(breakMin.value||0), sec:+(breakSec.value||0)} };
    seed=0; recalcTotal(); renderGauge();
    if(TIMER.running && !TIMER.paused) TIMER.resetFromCountdown();
    if(!TIMER.running || TIMER.paused){
      ELAPSED_LOCK.paused=true;
      ELAPSED_LOCK.value=elapsed.textContent;
    }
    window.dispatchEvent(new CustomEvent('app:applyTime',{detail:{payload}}));
  }
  applyBtn.addEventListener('click', applyTime);

  /* 입력창 보호 */
  document.addEventListener('keydown', (e)=>{
    if(!(TIMER.running && !TIMER.paused)) return;
    if(e.target===studyMin || e.target===studySec || e.target===breakMin || e.target===breakSec){
      e.preventDefault();
    }
  });

  /* 버튼 */
  const startBtn=document.getElementById('startBtn'), stopBtn=document.getElementById('stopBtn');
  function updateApplyBtn(){ applyBtn.disabled = (TIMER.running && !TIMER.paused); }
  startBtn.addEventListener('click', ()=>{
    stopBtn.disabled=false; stopBtn.textContent='정지';
    TIMER.start(); updateApplyBtn();
  });
  stopBtn.addEventListener('click', ()=>{
    if(!TIMER.running){ return; }
    if(!TIMER.paused){
      TIMER.pause(); stopBtn.textContent='재개';
    }else{
      TIMER.resume(); stopBtn.textContent='정지';
    }
    updateApplyBtn();
  });
})();
