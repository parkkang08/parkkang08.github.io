const video    = document.getElementById('video');
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const scoreEl  = document.getElementById('score');
const stateEl  = document.getElementById('stateText');
const previewBtn = document.getElementById('previewBtn');
const maxScoreEl = document.getElementById('maxScore');
const alarmToggleBtn = document.getElementById('alarmToggleBtn');
const vibrationToggleBtn = document.getElementById('vibrationToggleBtn');
const studyMinInput  = document.getElementById('studyMin');
const studySecInput  = document.getElementById('studySec');
const breakMinInput  = document.getElementById('breakMin');
const breakSecInput  = document.getElementById('breakSec');
const applyTimeBtn   = document.getElementById('applyTimeBtn');
const modeTextEl  = document.getElementById('modeText');
const countdownEl = document.getElementById('countdown');
const elapsedEl   = document.getElementById('elapsed');
const bannerEl    = document.getElementById('banner');
// ==== 소리 ====// 휴식 시작 = start.mp3, 공부 시작 = end.mp3const startSound = new Audio("/static/start.mp3");
 // 휴식 시작 / 공부 종료const endSound   = new Audio("/static/end.mp3");
   // 공부 시작 / 휴식 종료startSound.preload = "auto";
endSound.preload   = "auto";
// ==== 상태 ====let running    = false;
let lastState  = 'idle';
let stateStart = null;
let avg        = null;
  // 지수이동평균(최근 흐름)let maxScore   = 0;
let mediaStream = null;
let previewOn  = true;
let alarmOn     = true;
let vibrationOn = true;
// ▶ 집중 판정 기준(튜닝 A 적용)const THRESHOLD = 55;
let studySeconds = toSeconds(studyMinInput?.value ?? 25, studySecInput?.value ?? 0);
let breakSeconds = toSeconds(breakMinInput?.value ?? 5,  breakSecInput?.value ?? 0);
let mode = 'idle';
let remainingSec = 0;
let timerHandle = null;
let sessionStart = null;
const suppressAlertsDuringBreak = true;
const HOLD_SEC  = 3;
const INTERVAL  = 600;
// === 세션 평균용 누적 ===let sumScore = 0;
let countScore = 0;
// === 주기 종료 알림 ===function endCycleNotify(state) {
  const audio = state === 'focus' ? document.getElementById('endSound') : document.getElementById('startSound');
  if (audio) {
    audio.pause();
        // 현재 재생 중이면 중단    audio.currentTime = 0;
    audio.play().catch(e => {
      console.warn("오디오 재생 실패:", e);
    }
);
  }
}
// ==== 유틸 ====
function toSeconds(min, sec) {
  const m = Math.max(0, Number(min) || 0);
  const s = Math.min(59, Math.max(0, Number(sec) || 0));
  return m * 60 + s;
}
function formatMMSS(sec) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return `${
String(h).padStart(2,'0')}
:${
String(m).padStart(2,'0')}
:${
String(s).padStart(2,'0')}
`;
  }
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${
String(m).padStart(2,'0')}
:${
String(s).padStart(2,'0')}
`;
}
function formatHHMMSS(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${
String(h).padStart(2,'0')}
:${
String(m).padStart(2,'0')}
:${
String(s).padStart(2,'0')}
`;
}
// 브라우저 자동재생 권한 확보function unlockAudio() {
  const p1 = startSound.play().then(()=>{
 startSound.pause();
 startSound.currentTime = 0;
 }
).catch(()=>{
}
);
  const p2 = endSound.play().then(()=>{
 endSound.pause();
 endSound.currentTime = 0;
 }
).catch(()=>{
}
);
  Promise.allSettled([p1, p2]);
}
// ==== 카메라 ====navigator.mediaDevices.getUserMedia({
 video: true }
)  .then(stream => {
 mediaStream = stream;
 video.srcObject = stream;
 }
)  .catch(err => alert('카메라 권한이 필요합니다: ' + err.message));
// ==== 시작/정지 ====startBtn.onclick = async () => {
  unlockAudio();
  // 세션 평균 리셋  sumScore = 0;
  countScore = 0;
  // 시작 시: 공부 시작 소리(end.mp3)  playEndSound();
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled  = false;
  if (Notification && Notification.permission === 'default') {
    try {
 await Notification.requestPermission();
 }
 catch {
}
  }
  startStudyCycle();
  loop();
}
;
stopBtn.onclick = () => {
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  if (lastState !== 'idle' && stateStart) sendSegment(lastState, stateStart, new Date());
  lastState  = 'idle';
  stateStart = null;
  clearInterval(timerHandle);
  mode = 'idle';
  updateTimerUI();
}
;
// ==== 미리보기 on/off ====previewBtn?.addEventListener('click', ()=>{
  previewOn = !previewOn;
  video.style.visibility = previewOn ? 'visible' : 'hidden';
  previewBtn.textContent = previewOn ? '미리보기 끄기' : '미리보기 켜기';
}
);
// ==== 알람/진동 토글 ====alarmToggleBtn?.addEventListener('click', ()=>{
  alarmOn = !alarmOn;
  alarmToggleBtn.textContent = alarmOn ? '알람 끄기' : '알람 켜기';
}
);
vibrationToggleBtn?.addEventListener('click', ()=>{
  vibrationOn = !vibrationOn;
  vibrationToggleBtn.textContent = vibrationOn ? '진동 끄기' : '진동 켜기';
}
);
// ==== 시간 적용 ====applyTimeBtn?.addEventListener('click', ()=>{
  studySeconds = toSeconds(studyMinInput.value, studySecInput.value);
  breakSeconds = toSeconds(breakMinInput.value, breakSecInput.value);
  if (!running || mode === 'idle') updateTimerUI();
}
);
// ==== 분석 루프 ====async function loop() {
  while (running) {
    const img   = captureFrame();
    const score = await analyze(img);
    updateUI(score);
    handleStateAndAlerts(score);
    await sleep(INTERVAL);
  }
}
function captureFrame() {
  const c = document.createElement('canvas');
  c.width  = video.videoWidth  || 640;
  c.height = video.videoHeight || 480;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg');
}
async function analyze(imageDataURL) {
  try {
    const res = await fetch('/analyze', {
      method: 'POST',      headers: {
 'Content-Type': 'application/json' }
,      body: JSON.stringify({
 image: imageDataURL }
)    }
);
    const data = await res.json();
    return data.score ?? 0;
  }
 catch (e) {
    console.error(e);
    return 0;
  }
}
function updateUI(score) {
  // 최근 흐름(EMA)  avg = (avg === null) ? score : (avg * 0.7 + score * 0.3);
  const rounded = Math.round(avg);
  // 세션 평균 누적  sumScore += score;
  countScore++;
  const sessionAvg = Math.round(sumScore / Math.max(1, countScore));
  if (rounded > maxScore) {
    maxScore = rounded;
    maxScoreEl && (maxScoreEl.textContent = `최고 집중도: ${
maxScore}
%`);
  }
  scoreEl.textContent = `집중도: ${
rounded}
% (평균: ${
sessionAvg}
%)`;
  scoreEl.className = (rounded >= THRESHOLD) ? 'focus' : 'distract';
}
let belowSince = null;
function handleStateAndAlerts(score) {
  if (mode === 'break' && suppressAlertsDuringBreak) return;
  const now = new Date();
  const isFocus = score >= THRESHOLD;
  const newState = isFocus ? 'focus' : 'distract';
  if (lastState !== 'idle' && newState !== lastState && stateStart) {
    sendSegment(lastState, stateStart, now);
    stateStart = now;
  }
  if (lastState === 'idle') stateStart = now;
  lastState = newState;
  stateEl.textContent = `현재 상태: ${
newState === 'focus' ? '집중' : '비집중'}
`;
  if (!isFocus) {
    if (!belowSince) belowSince = now;
    const elapsed = (now - belowSince) / 1000;
    if (elapsed >= HOLD_SEC) {
      if (vibrationOn && navigator.vibrate) navigator.vibrate([250,120,250]);
      if (Notification && Notification.permission === 'granted' && alarmOn) {
        new Notification('집중력 낮음', {
 body: '자세 바로잡기 / 눈 휴식' }
);
      }
      belowSince = now;
    }
  }
 else {
    belowSince = null;
  }
}
// ==== 타이머 ====function startStudyCycle() {
  mode = 'study';
  remainingSec = Math.max(1, Math.floor(studySeconds));
  sessionStart = sessionStart ?? new Date();
  showBanner('공부 시작!', 'ok');
  updateModePill();
  tickTimer();
  clearInterval(timerHandle);
  timerHandle = setInterval(tickTimer, 1000);
}
function startBreakCycle() {
  mode = 'break';
  remainingSec = Math.max(1, Math.floor(breakSeconds));
  showBanner('휴식 시작!', 'info');
  updateModePill();
  tickTimer();
}
function tickTimer() {
  if (mode === 'study' || mode === 'break') {
    remainingSec = Math.max(0, remainingSec - 1);
    if (remainingSec === 0) {
      if (mode === 'study') {
        // 공부 끝 → 휴식 시작 (start.mp3)        playStartSound();
        endCycleNotify('공부 종료! 휴식 시작');
        startBreakCycle();
      }
 else {
        // 휴식 끝 → 공부 시작 (end.mp3)        playEndSound();
        endCycleNotify('휴식 종료! 공부 시작');
        startStudyCycle();
      }
    }
  }
  updateTimerUI();
}
// ==== 소리 재생 ====function playStartSound(){
  try {
 endSound.pause();
 }
 catch(e){
}
  startSound.currentTime = 0;
  startSound.play().catch(()=>{
}
);
}
function playEndSound(){
  try {
 startSound.pause();
 }
 catch(e){
}
  endSound.currentTime = 0;
  endSound.play().catch(()=>{
}
);
}
// ==== UI 업데이트 ====function endCycleNotify(msg) {
  showBanner(msg, 'info');
  if (Notification && Notification.permission === 'granted') new Notification(msg);
}
function updateTimerUI() {
  updateModePill();
  countdownEl.textContent = `남은 시간: ${
formatMMSS(remainingSec)}
`;
  const elapsed = sessionStart ? Math.floor((Date.now() - sessionStart.getTime())/1000) : 0;
  elapsedEl.textContent = `경과 시간: ${
formatHHMMSS(elapsed)}
`;
}
function updateModePill() {
  modeTextEl.textContent = `모드: ${
mode === 'study' ? '공부' : mode === 'break' ? '휴식' : '-'}
`;
  modeTextEl.classList.remove('mode-study','mode-break','mode-idle');
  modeTextEl.classList.add(mode === 'study' ? 'mode-study' : mode === 'break' ? 'mode-break' : 'mode-idle');
}
function showBanner(message, type='ok') {
  if (!bannerEl) return;
  bannerEl.textContent = message;
  bannerEl.classList.remove('ok','info');
  bannerEl.classList.add(type);
  bannerEl.style.display = 'block';
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(()=>{
 bannerEl.style.display = 'none';
 }
, 2500);
}
// ==== 서버 로그 저장 ====async function sendSegment(state, startTime, endTime) {
  try {
    await fetch('/log', {
      method: 'POST',      headers: {
 'Content-Type': 'application/json' }
,      body: JSON.stringify({
        state,        start: startTime.toISOString(),        end:   endTime.toISOString()      }
)    }
);
  }
 catch (e) {
 console.error('log error', e);
 }
}
function sleep(ms){
 return new Promise(r=>setTimeout(r, ms));
 }
