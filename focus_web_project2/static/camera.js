(function(){
  const ICON_MAP = {
    startBtn:'▶', stopBtn:'⏹', previewBtn:'👁',
    alarmToggleBtn:'🔔', vibrationToggleBtn:'📳',
    flipBtn:'↔', applyTimeBtn:'⏱'
  };
  const stripEmoji = s => (s||'').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u,'').trim();
  function ensureIcon(btn, icon){
    if(!btn) return;
    if(btn.getAttribute('data-icon')!==icon) btn.setAttribute('data-icon',icon);
    const raw=btn.textContent, t=stripEmoji(raw);
    if(raw!==t) btn.textContent=t;
  }
  function repairIcons(){ for(const [id,ic] of Object.entries(ICON_MAP)) ensureIcon(document.getElementById(id), ic); }
  document.addEventListener('DOMContentLoaded', repairIcons);
  setInterval(repairIcons, 150);

  function callOne(names, ...args){
    for(const n of names){
      const f=typeof window[n]==='function' && window[n];
      if(f){ try{ f(...args); return n; }catch(e){ console.error(e); } }
    }
    return null;
  }
  function emit(name, detail){
    window.dispatchEvent(new CustomEvent(name,{detail}));
    document.dispatchEvent(new CustomEvent(name,{detail}));
  }

  const videoEl = document.getElementById('video');
  async function startCamera(){
    try{
      if(videoEl.srcObject) return;
      const s = await navigator.mediaDevices.getUserMedia({video:true, audio:false});
      videoEl.srcObject = s; videoEl.muted = true; await videoEl.play().catch(()=>{});
    }catch(e){ console.warn('카메라 접근 실패:', e); }
  }
  window.addEventListener('load', startCamera);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && !videoEl.srcObject) startCamera(); });

  const previewBtn = document.getElementById('previewBtn');
  function applyPreviewVisibility(){
    const on=(previewBtn.dataset.state!=='off');
    videoEl.style.visibility = on ? 'visible' : 'hidden';
  }
  previewBtn.addEventListener('click', ()=>{
    callOne(['togglePreview']);
    previewBtn.dataset.state = (previewBtn.dataset.state==='off')?'on':'off';
    previewBtn.textContent = (previewBtn.dataset.state==='on')?'미리보기 끄기':'미리보기 켜기';
    repairIcons(); applyPreviewVisibility();
    emit('app:previewToggle',{state:previewBtn.dataset.state});
  });
  previewBtn.dataset.state='on'; applyPreviewVisibility();

  const flipBtn = document.getElementById('flipBtn'); let flipped=false;
  flipBtn.addEventListener('click', ()=>{
    flipped=!flipped; videoEl.style.transform = flipped?'scaleX(-1)':'scaleX(1)';
    flipBtn.textContent = flipped?'반전 해제':'좌우 반전'; repairIcons();
    emit('app:flip',{flipped});
  });

  function toggleLabel(btn, onLabel, offLabel){
    const on=(btn.dataset.state!=='off');
    btn.dataset.state=on?'off':'on';
    btn.textContent=(btn.dataset.state==='on')?onLabel:offLabel;
    repairIcons();
  }
  const alarmToggleBtn = document.getElementById('alarmToggleBtn');
  const vibrationToggleBtn = document.getElementById('vibrationToggleBtn');
  alarmToggleBtn.addEventListener('click', ()=>{
    callOne(['toggleAlarm']);
    toggleLabel(alarmToggleBtn,'알람 끄기','알람 켜기');
    emit('app:alarmToggle',{state:alarmToggleBtn.dataset.state});
  });
  vibrationToggleBtn.addEventListener('click', ()=>{
    callOne(['toggleVibration']);
    toggleLabel(vibrationToggleBtn,'진동 끄기','진동 켜기');
    emit('app:vibrationToggle',{state:vibrationToggleBtn.dataset.state});
  });
})();
