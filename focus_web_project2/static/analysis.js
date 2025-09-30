(function(){
  const videoEl=document.getElementById('video');
  const scoreEl=document.getElementById('score');
  const maxEl=document.getElementById('maxScore');

  let holistic, running=false, sending=false, rafId=0;
  let baselineEar=null, smooth=0, best=0, lastPosture=1, peakStreak=0;

  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const ema=(p,n,a=0.25)=>(p==null?n:(p+(n-p)*a));
  const dist=(a,b)=>Math.hypot(a.x-b.x, a.y-b.y);

  function torsoAngleDeg(shoulderMid, hipMid){
    const vx=shoulderMid.x-hipMid.x, vy=shoulderMid.y-hipMid.y;
    const len=Math.hypot(vx,vy)||1e-6; const cos=clamp((-vy)/len,-1,1);
    return Math.acos(cos)*180/Math.PI;
  }
  function getHolisticCtor(){
    return (window.holistic && window.holistic.Holistic) || window.Holistic;
  }
  async function ensureHolistic(){
    if(holistic) return;
    const Ctor=getHolisticCtor();
    if(!Ctor){ console.error('Holistic 로드 실패'); return; }
    holistic=new Ctor({locateFile:(f)=>`https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5/${f}`});
    holistic.setOptions({
      modelComplexity:1,
      refineFaceLandmarks:true,
      smoothLandmarks:true,
      minDetectionConfidence:0.5,
      minTrackingConfidence:0.5
    });
    holistic.onResults(onResults);
  }

  function onResults(res){
    const face=res.faceLandmarks, pose=res.poseLandmarks;

    /* === 눈 (60%) === */
    let eyeScore=0.08; let ear=0.0;
    if(face && face.length>=468){
      const L_TOP=face[159], L_BOT=face[145], L_OUT=face[33],  L_IN=face[133];
      const R_TOP=face[386], R_BOT=face[374], R_OUT=face[362], R_IN=face[263];
      const left  = dist(L_TOP,L_BOT)/(dist(L_OUT,L_IN)+1e-6);
      const right = dist(R_TOP,R_BOT)/(dist(R_OUT,R_IN)+1e-6);
      ear=(left+right)/2;

      const postureOk=lastPosture>=0.8;
      const notBlink = ear>0.18;
      if(postureOk && notBlink && ear>0.20 && ear<0.40){
        baselineEar=ema(baselineEar, ear, 0.01);
      }
      const base=baselineEar || ear;
      const r=clamp(ear/(base+1e-6), 0, 1.4);
      const low=0.70, high=1.05;
      eyeScore=clamp((r-low)/(high-low), 0, 1);
    }

    /* === 자세 (40%) === */
    let posture=0.3;
    if(pose && pose.length>=25){
      const lS=pose[11], rS=pose[12], lH=pose[23], rH=pose[24];
      if(lS&&rS&&lH&&rH){
        const shoulderMid={x:(lS.x+rS.x)/2, y:(lS.y+rS.y)/2};
        const hipMid     ={x:(lH.x+rH.x)/2, y:(lH.y+rH.y)/2};
        const ang=torsoAngleDeg(shoulderMid, hipMid);
        const a0=8, a1=30;
        posture=clamp(1 - (ang-a0)/(a1-a0), 0, 1);
      }
    }
    lastPosture=posture;

    /* === 집중도 계산 === */
    const goodNow = face && ear>0 && (eyeScore>0.95) && (posture>0.95);
    peakStreak = goodNow ? Math.min(90, peakStreak+1) : Math.max(0, peakStreak-1);
    const softCap = (peakStreak>=45) ? 1.0 : 0.95; // ~1.5초 이상 유지 시 100% 허용

    let c=0.6*eyeScore + 0.4*posture;
    if(!face) c*=0.5;
    c = Math.min(c, softCap);

    smooth=ema(smooth,c,0.35);
    const s=Math.round(clamp(smooth,0,1)*100);

    if(scoreEl){
      scoreEl.textContent=`집중도 ${s}%`;
      scoreEl.classList.remove('focus','distract');
      scoreEl.classList.add(s>=60?'focus':'distract');
    }
    if(maxEl){
      best=Math.max(best,s);
      maxEl.textContent=`최고 집중도: ${best}%`;
    }
  }

  async function loop(){
    if(!running || !holistic) return;
    if(!sending){
      try{
        sending=true;
        await holistic.send({image:videoEl});
      }catch(e){ console.error(e); }
      finally{ sending=false; }
    }
    rafId=requestAnimationFrame(loop);
  }

  async function start(){
    if(running) return;
    await ensureHolistic();
    baselineEar=null; smooth=0; peakStreak=0;
    running=true;
    cancelAnimationFrame(rafId);
    loop();
  }
  function stop(){
    running=false;
    cancelAnimationFrame(rafId);
  }

  // 전역으로 연결 (UI / timer.js에서 호출 가능하게)
  window.startRealtime  = window.startRealtime  || start;
  window.startRealTime  = window.startRealTime  || start;
  window.startAnalysis  = window.startAnalysis  || start;
  window.start          = window.start          || start;
  window.startDetection = window.startDetection || start;
  window.stopRealtime   = window.stopRealtime   || stop;
  window.stopAnalysis   = window.stopAnalysis   || stop;
  window.stop           = window.stop           || stop;
  window.stopDetection  = window.stopDetection  || stop;
})();
