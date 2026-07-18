/* ============================================================
   1+1 · Ambient FX engine — one designed, animated background
   layer per section. Self-initialising.
   Reads on <body> (or any [data-fx] element):
     data-fx       behavior key (else falls back to data-area)
     data-fx-color hex accent (else computed --ac, else gold)
     data-fx-target  optional CSS selector to mount into (absolute)
   Behaviors: escudo · valor · verdad · futuro · pyme ·
              constellation · pulse · grid · ledger · stream · dust
   ============================================================ */
(function(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function hexRgb(h){ h=(h||'').trim().replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); const n=parseInt(h||'b8934a',16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  const rand=(a,b)=>a+Math.random()*(b-a);

  function run(opts){
    opts = opts || {};
    const target = opts.target || null;
    if(!target){ if(window.__fxFull) return; window.__fxFull = true; }
    const body = document.body;
    const fx = opts.fx || body.getAttribute('data-fx') || body.getAttribute('data-area') || 'dust';
    let hex = opts.color || body.getAttribute('data-fx-color');
    if(!hex){ const v=getComputedStyle(body).getPropertyValue('--ac').trim(); hex = v || '#B8934A'; }
    let hex2 = opts.color2 || (getComputedStyle(body).getPropertyValue('--ac-deep').trim() || hex);
    const [r,g,b] = hexRgb(hex);
    const [r2,g2,b2] = hexRgb(hex2);
    const AREA_COLORS = [[168,56,56],[184,147,74],[61,107,126],[90,127,122],[53,122,40]];

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    let W,H,DPR,P=[],t=0,glyphFont='';
    const col=(a)=>`rgba(${r},${g},${b},${a})`;
    const col2=(a)=>`rgba(${r2},${g2},${b2},${a})`;

    if(target){
      const host = document.querySelector(target);
      if(host){ if(getComputedStyle(host).position==='static') host.style.position='relative';
        cv.style.cssText='position:absolute;inset:0;z-index:0;pointer-events:none;'; host.insertBefore(cv, host.firstChild);
        cv._host=host;
      } else { mountFixed(); }
    } else { mountFixed(); }
    function mountFixed(){ cv.style.cssText='position:fixed;inset:0;z-index:0;pointer-events:none;'; body.insertBefore(cv, body.firstChild); }

    /* ---- cursor interaction: themed glow + particle repulsion ---- */
    const mouse={x:-1e4,y:-1e4,on:false};
    const fixed=!cv._host;
    const spot=document.createElement('div');
    spot.style.cssText='position:'+(fixed?'fixed':'absolute')+';inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity .35s ease;'+
      'background:radial-gradient(260px circle at var(--fx-mx,-300px) var(--fx-my,-300px), rgba('+r+','+g+','+b+',.26), rgba('+r+','+g+','+b+',.09) 42%, transparent 72%);';
    (cv._host||body).insertBefore(spot, cv.nextSibling);
    const evt=cv._host||window;
    function onMove(e){ const rect=cv.getBoundingClientRect(); const lx=e.clientX-rect.left, ly=e.clientY-rect.top;
      mouse.x=lx*DPR; mouse.y=ly*DPR; mouse.on=true;
      spot.style.setProperty('--fx-mx',lx+'px'); spot.style.setProperty('--fx-my',ly+'px'); spot.style.opacity='1';
      if(fx==='pulse' && t-lastRing>9){ lastRing=t; P.push({x:mouse.x,y:mouse.y,r:0,vr:rand(1,2)*DPR,a:.55}); if(P.length>14)P.shift(); } }
    function onLeave(){ mouse.on=false; spot.style.opacity='0'; }
    evt.addEventListener('pointermove',onMove); evt.addEventListener('pointerleave',onLeave);

    function dims(){
      DPR=Math.min(devicePixelRatio||1,2);
      const w = cv._host ? cv._host.clientWidth : innerWidth;
      const h = cv._host ? cv._host.clientHeight : innerHeight;
      W=cv.width=w*DPR; H=cv.height=h*DPR; cv.style.width=w+'px'; cv.style.height=h+'px';
      glyphFont = (10*DPR)+'px '+(getComputedStyle(body).getPropertyValue('--font-mono')||'monospace');
    }
    function resize(){ dims(); build(); }

    function build(){
      P=[];
      const dens = innerWidth/(fx==='verdad'||fx==='constellation'?20:12);
      const n = Math.min(fx==='stream'?60:fx==='verdad'||fx==='constellation'?60:130, Math.floor(dens));
      if(fx==='pulse'){ /* rings spawned over time */ return; }
      if(fx==='grid'){ return; }
      if(fx==='stream'){ const cols=Math.floor(W/(20*DPR)); for(let i=0;i<cols;i++) P.push({x:i*20*DPR+8*DPR, y:rand(-H,0), v:rand(1.4,3.6)*DPR, len:Math.floor(rand(5,12)), a:rand(.32,.6)}); return; }
      for(let i=0;i<n;i++) P.push(spawn(true));
    }

    function spawn(init){
      const p={};
      switch(fx){
        case 'escudo': p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,30*DPR); p.vy=-rand(.2,.7)*DPR; p.sway=rand(.5,1.4); p.ph=rand(0,6.28); p.r=rand(1.1,3.2)*DPR; p.a=rand(.22,.5); break;
        case 'valor': p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,20*DPR); p.vy=-rand(.3,.9)*DPR; p.r=rand(1.1,3)*DPR; p.a=rand(.2,.46); p.spark=Math.random()<.24; p.ph=rand(0,6.28); break;
        case 'futuro': p.x=init?rand(0,W):-rand(0,40*DPR); p.y=rand(0,H); p.base=p.y; p.vx=rand(.5,1.4)*DPR; p.amp=rand(10,46)*DPR; p.freq=rand(.002,.006); p.ph=rand(0,6.28); p.r=rand(1,2.4)*DPR; p.a=rand(.2,.42); break;
        case 'pyme': p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,30*DPR); p.vy=-rand(.22,.6)*DPR; p.sway=rand(.7,1.8); p.ph=rand(0,6.28); p.rot=rand(0,6.28); p.vr=rand(-.025,.025); p.r=rand(3.4,7)*DPR; p.a=rand(.22,.46); break;
        case 'ledger': p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,30*DPR); p.vy=-rand(.25,.6)*DPR; p.gl=['$','+','%','0','9','='][Math.floor(rand(0,6))]; p.s=rand(10,20)*DPR; p.a=rand(.2,.45); p.sway=rand(.3,1); p.ph=rand(0,6.28); break;
        case 'constellation': { const c=AREA_COLORS[(Math.random()*AREA_COLORS.length)|0]; p.x=rand(0,W); p.y=rand(0,H); p.vx=rand(-.3,.3)*DPR; p.vy=rand(-.3,.3)*DPR; p.r=rand(1.4,3)*DPR; p.a=rand(.3,.55); p.c=c; break; }
        default: /* verdad + dust */ p.x=rand(0,W); p.y=rand(0,H); p.vx=rand(-.3,.3)*DPR; p.vy=rand(-.3,.3)*DPR; p.r=rand(1.4,3)*DPR; p.a=rand(.24,.5);
      }
      return p;
    }

    let lastRing=0;
    function repel(p){ if(!mouse.on) return; const dx=p.x-mouse.x, dy=p.y-mouse.y, R=140*DPR, d2=dx*dx+dy*dy; if(d2<R*R){ const d=Math.sqrt(d2)||1, f=(1-d/R)*7*DPR; p.x+=dx/d*f; p.y+=dy/d*f; } }
    function frame(){
      t+=1; ctx.clearRect(0,0,W,H);

      if(fx==='verdad' || fx==='constellation'){
        const D=140*DPR, multi=(fx==='constellation');
        for(const p of P){ p.x+=p.vx; p.y+=p.vy; repel(p); if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1; }
        for(let i=0;i<P.length;i++) for(let j=i+1;j<P.length;j++){ const a=P[i],bb=P[j],dx=a.x-bb.x,dy=a.y-bb.y,d=Math.hypot(dx,dy);
          if(d<D){ ctx.strokeStyle=multi?`rgba(184,147,74,${0.16*(1-d/D)})`:col(0.2*(1-d/D)); ctx.lineWidth=1.1*DPR; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(bb.x,bb.y); ctx.stroke(); } }
        for(const p of P){ ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=multi?`rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a})`:col(p.a); ctx.fill(); }
      }
      else if(fx==='futuro'){
        for(const p of P){ p.x+=p.vx; p.y=p.base+Math.sin(p.x*p.freq+p.ph)*p.amp;
          for(let k=0;k<4;k++){ const xx=p.x-k*7*DPR; ctx.beginPath(); ctx.arc(xx,p.base+Math.sin(xx*p.freq+p.ph)*p.amp,p.r*(1-k*0.18),0,6.28); ctx.fillStyle=col(p.a*(1-k*0.24)); ctx.fill(); }
          if(p.x>W+30*DPR) Object.assign(p,spawn(false)); }
      }
      else if(fx==='pyme'){
        for(const p of P){ p.ph+=.012; p.rot+=p.vr; p.y+=p.vy; p.x+=Math.sin(p.ph)*p.sway*DPR*.35; repel(p);
          ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.ellipse(0,0,p.r,p.r*.5,0,0,6.28); ctx.fillStyle=col(p.a); ctx.fill();
          ctx.strokeStyle=col2(p.a*.7); ctx.lineWidth=1*DPR; ctx.beginPath(); ctx.moveTo(-p.r,0); ctx.lineTo(p.r,0); ctx.stroke();
          ctx.restore(); if(p.y<-20*DPR) Object.assign(p,spawn(false)); }
      }
      else if(fx==='escudo'){
        for(const p of P){ p.ph+=.03; p.y+=p.vy; p.x+=Math.sin(p.ph)*p.sway*DPR*.3; repel(p);
          const tw=p.a*(0.55+0.45*Math.sin(p.ph*1.7));
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(tw); ctx.fill();
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r*2.4,0,6.28); ctx.fillStyle=col(tw*.12); ctx.fill();
          if(p.y<-10*DPR) Object.assign(p,spawn(false)); }
      }
      else if(fx==='valor'){
        for(const p of P){ p.y+=p.vy; p.ph+=.06; repel(p);
          if(p.spark){ const s=p.r*1.8, tw=p.a*(0.5+0.5*Math.sin(p.ph)); ctx.strokeStyle=col2(tw); ctx.lineWidth=1.2*DPR;
            ctx.beginPath(); ctx.moveTo(p.x-s,p.y); ctx.lineTo(p.x+s,p.y); ctx.moveTo(p.x,p.y-s); ctx.lineTo(p.x,p.y+s); ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill(); }
          if(p.y<-10*DPR) Object.assign(p,spawn(false)); }
      }
      else if(fx==='ledger'){
        ctx.font=glyphFont; ctx.textAlign='center'; ctx.textBaseline='middle';
        for(const p of P){ p.y+=p.vy; p.ph+=.02; p.x+=Math.sin(p.ph)*p.sway*DPR*.2; repel(p);
          ctx.font=(p.s|0)+'px '+(getComputedStyle(body).getPropertyValue('--font-mono')||'monospace');
          ctx.fillStyle=col(p.a); ctx.fillText(p.gl, p.x, p.y);
          if(p.y<-20*DPR) Object.assign(p,spawn(false)); }
      }
      else if(fx==='stream'){
        for(const p of P){ p.y+=p.v;
          for(let k=0;k<p.len;k++){ const yy=p.y-k*10*DPR; if(yy<0||yy>H) continue;
            let a = k===0 ? Math.min(.8,p.a*1.6) : p.a*(1-k/p.len); if(mouse.on&&Math.abs(p.x-mouse.x)<70*DPR) a=Math.min(.95,a*1.8); ctx.fillStyle=col(a);
            ctx.fillRect(p.x, yy, 3*DPR, 6*DPR); }
          if(p.y-p.len*10*DPR>H) { p.y=rand(-H*.4,0); p.v=rand(1.4,3.6)*DPR; p.len=Math.floor(rand(5,12)); p.a=rand(.32,.6); } }
      }
      else if(fx==='grid'){
        const gap=34*DPR; const cx=mouse.on?mouse.x:W*(0.5+0.4*Math.sin(t*0.006)), cy=mouse.on?mouse.y:H*(0.5+0.4*Math.cos(t*0.008)), R=Math.min(W,H)*0.42;
        for(let x=gap/2;x<W;x+=gap) for(let y=gap/2;y<H;y+=gap){ const d=Math.hypot(x-cx,y-cy); const w=Math.max(0,1-d/R);
          const rr=(1+w*2.2)*DPR; ctx.beginPath(); ctx.arc(x,y,rr,0,6.28); ctx.fillStyle=col(0.1+w*0.4); ctx.fill(); }
      }
      else if(fx==='pulse'){
        if(t-lastRing>52){ lastRing=t; P.push({x:rand(W*.1,W*.9), y:rand(H*.1,H*.9), r:0, vr:rand(.9,1.8)*DPR, a:.5}); if(P.length>10) P.shift(); }
        for(const p of P){ p.r+=p.vr; p.a*=0.985;
          ctx.strokeStyle=col(Math.max(0,p.a)); ctx.lineWidth=2*DPR; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.stroke();
          ctx.fillStyle=col(Math.max(0,p.a)*.9); ctx.beginPath(); ctx.arc(p.x,p.y,2.5*DPR,0,6.28); ctx.fill(); }
        P=P.filter(p=>p.a>0.02);
      }
      else { /* dust */
        for(const p of P){ p.x+=p.vx; p.y+=p.vy; if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0; repel(p);
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill(); }
      }
      requestAnimationFrame(frame);
    }
    resize(); addEventListener('resize', resize);
    if(cv._host && window.ResizeObserver){ new ResizeObserver(()=>{ dims(); build(); }).observe(cv._host); }
    frame();
  }

  window.runFX = run;
  // self-init for pages that just include this file
  function auto(){ if(document.body.hasAttribute('data-fx') || document.body.hasAttribute('data-area')) run({}); }
  if(document.readyState!=='loading') auto(); else document.addEventListener('DOMContentLoaded', auto);
})();
