/* Shared shell for 1+1 area module pages. Reads <body data-area="..."> */
(function(){
  const AREAS = [
    { id:'escudo', name:'Escudo', icon:'shield',       href:'El Escudo.html' },
    { id:'valor',  name:'Valor',  icon:'trending-up',  href:'El Valor.html' },
    { id:'verdad', name:'Verdad', icon:'scale',        href:'La Verdad.html' },
    { id:'futuro', name:'Futuro', icon:'compass',      href:'El Futuro.html' },
  ];
  const EASE = 'cubic-bezier(.16,1,.3,1)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function header(active){
    const pills = AREAS.map(a =>
      `<a href="${a.href}" class="apill ${a.id===active?'on':''}"><i data-lucide="${a.icon}" class="pi"></i>${a.name}</a>`
    ).join('');
    return `
      <a href="Landing Hero.html" class="hbrand">
        <span class="mk">1<span class="plus">+</span>1</span>
        <span class="lbl">COMMAND</span>
      </a>
      <div class="hsep"></div>
      <div class="search">
        <i data-lucide="search" style="width:15px;height:15px;"></i>
        <span>Buscar caso, cliente, norma…</span>
        <span class="kbd">Ctrl K</span>
      </div>
      <nav class="areanav">${pills}</nav>
      <div class="hspring"></div>
      <div class="hactions">
        <a href="Pipeline NIIF Elite.html" class="niif"><i data-lucide="sparkles" class="pi"></i>Informe NIIF Elite</a>
        <a href="Alertas.html" class="iconbtn"><i data-lucide="bell" class="pi"></i><span class="nbadge">3</span></a>
        <div class="lang"><button class="on">ES</button><button>EN</button></div>
        <a href="Settings.html" class="avatar">YO</a>
      </div>`;
  }

  // ---------- chart helpers (with draw-on animation) ----------
  function p(pts){ return pts.map((q,i)=>(i?'L':'M')+q[0]+' '+q[1]).join(' '); }

  function drawLine(el){
    if(reduce) return;
    const len = el.getTotalLength();
    el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
    el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 1.15s '+EASE;
    requestAnimationFrame(()=>{ el.style.strokeDashoffset = '0'; });
  }
  function fadeIn(el, delay){
    if(reduce) return;
    el.style.opacity = '0'; el.getBoundingClientRect();
    el.style.transition = 'opacity .5s ease '+(delay||0)+'ms';
    requestAnimationFrame(()=>{ el.style.opacity = el.dataset.o || '1'; });
  }

  window.sparkline = function(id, vals, color, fill){
    const svg = document.getElementById(id); if(!svg) return;
    const W=280,H=70,pad=5, max=Math.max(...vals), min=Math.min(...vals);
    const pts = vals.map((v,i)=>[pad+i*(W-2*pad)/(vals.length-1), H-pad-((v-min)/((max-min)||1))*(H-2*pad)]);
    const line=p(pts), area=line+` L${W-pad} ${H} L${pad} ${H} Z`;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio','none');
    svg.innerHTML = `<path class="spk-area" d="${area}" fill="${fill}"/><path class="spk" d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/><circle class="spk-dot" cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="3.6" fill="${color}"/>`;
    drawLine(svg.querySelector('.spk'));
    const dot=svg.querySelector('.spk-dot'); fadeIn(dot, 1050);
  };

  window.bars = function(id, vals, color){
    const svg = document.getElementById(id); if(!svg) return;
    const W=280,H=70,n=vals.length,gap=7,bw=(W-(n-1)*gap)/n,max=Math.max(...vals);
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio','none');
    svg.innerHTML = vals.map((v,i)=>{const h=(v/max)*(H-4),x=i*(bw+gap),y=H-h;return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${color}" opacity="${(0.4+0.6*(i/(n-1))).toFixed(2)}"/>`;}).join('');
    if(reduce) return;
    svg.querySelectorAll('rect').forEach((r,i)=>{
      r.style.transformBox='fill-box'; r.style.transformOrigin='bottom'; r.style.transform='scaleY(.55)';
      r.getBoundingClientRect();
      r.style.transition='transform .6s '+EASE+' '+(i*55)+'ms';
      requestAnimationFrame(()=>{ r.style.transform='scaleY(1)'; });
    });
  };

  window.scenarios = function(id, base, opt, pes, color, down){
    const svg=document.getElementById(id); if(!svg) return;
    const W=280,H=70,pad=5;
    const mk=a=>a.map((v,i)=>[pad+i*(W-2*pad)/(a.length-1),H-pad-(v/100)*(H-2*pad)]);
    const B=mk(base),O=mk(opt),P=mk(pes);
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio','none');
    svg.innerHTML =
      `<path class="sc-o" d="${p(O)}" fill="none" stroke="${color}" stroke-width="1.5" opacity=".5" stroke-dasharray="3 3"/>`+
      `<path class="sc-p" d="${p(P)}" fill="none" stroke="${down}" stroke-width="1.5" opacity=".5" stroke-dasharray="3 3"/>`+
      `<path class="sc-b" d="${p(B)}" fill="none" stroke="${color}" stroke-width="2.6"/>`+
      `<circle class="spk-dot" cx="${B.at(-1)[0]}" cy="${B.at(-1)[1]}" r="3.6" fill="${color}"/>`;
    const o=svg.querySelector('.sc-o'), pp=svg.querySelector('.sc-p');
    drawLine(svg.querySelector('.sc-b'));
    fadeIn(svg.querySelector('.spk-dot'), 1050);
  };

  // ---------- count-up ----------
  function parseNum(s){
    const m = (s||'').trim().match(/^([^\d]*)([\d.,]+)(.*)$/);
    if(!m) return null;
    const pre=m[1], raw=m[2], suf=m[3];
    const hasComma = raw.includes(',');
    const val = parseFloat(raw.replace(/\./g,'').replace(',','.'));
    if(isNaN(val)) return null;
    const decimals = hasComma ? (raw.split(',')[1]||'').length : 0;
    return {pre, val, decimals, suf};
  }
  function fmt(v, d){ return v.toLocaleString('es-CO',{minimumFractionDigits:d, maximumFractionDigits:d}); }
  function countUp(el){
    const node = el.firstChild;
    if(!node || node.nodeType!==3) return;
    const info = parseNum(node.nodeValue);
    if(!info) return;
    if(reduce){ node.nodeValue = info.pre+fmt(info.val,info.decimals)+info.suf; return; }
    const dur=950, t0=performance.now();
    function step(t){
      const pr=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-pr,3);
      node.nodeValue = info.pre + fmt(info.val*e, info.decimals) + info.suf;
      if(pr<1) requestAnimationFrame(step);
      else node.nodeValue = info.pre + fmt(info.val, info.decimals) + info.suf;
    }
    requestAnimationFrame(step);
  }

  // ---------- entrance reveal + count observers ----------
  function setupMotion(){
    // staggered reveal within each group
    function reveal(sel, base){
      document.querySelectorAll(sel).forEach((el,i)=>{
        el.classList.add('reveal');
        el.style.transitionDelay = ((base||0)+i*55)+'ms';
      });
    }
    reveal('.subcard', 40);
    reveal('.ladder-item', 30);
    reveal('.pago', 30);
    reveal('.diacard', 40);
    document.querySelectorAll('.sec, .ahero, .panel:not(.semaforo)').forEach(el=>el.classList.add('reveal'));

    const io = new IntersectionObserver((es)=>{
      es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    },{ threshold:.12, rootMargin:'0px 0px -6% 0px' });
    document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

    // count-up when value enters view
    document.querySelectorAll('.hero-kpi .kv, .subkpis .v, .diacard .v, .pago .amt').forEach(el=>el.classList.add('js-count'));
    const co = new IntersectionObserver((es)=>{
      es.forEach(e=>{ if(e.isIntersecting){ countUp(e.target); co.unobserve(e.target); } });
    },{ threshold:.5 });
    document.querySelectorAll('.js-count').forEach(el=>co.observe(el));
  }

  // ---------- ambient particle FX (unique per area) ----------
  function hexRgb(h){ h=(h||'').trim().replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); const n=parseInt(h||'b8934a',16); return [(n>>16)&255,(n>>8)&255,n&255]; }

  function initFX(area){
    if(reduce) return;
    const cs = getComputedStyle(document.body);
    const [r,g,b] = hexRgb(cs.getPropertyValue('--ac'));
    const [r2,g2,b2] = hexRgb(cs.getPropertyValue('--ac-deep'));
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
    document.body.insertBefore(cv, document.body.firstChild);
    const ctx = cv.getContext('2d');
    let W,H,DPR,P=[],t=0;
    const col=(a)=>`rgba(${r},${g},${b},${a})`;
    const col2=(a)=>`rgba(${r2},${g2},${b2},${a})`;
    const rand=(a,b)=>a+Math.random()*(b-a);

    function resize(){
      DPR=Math.min(devicePixelRatio||1,2);
      W=cv.width=innerWidth*DPR; H=cv.height=innerHeight*DPR;
      cv.style.width=innerWidth+'px'; cv.style.height=innerHeight+'px';
      build();
    }
    function build(){
      const base=Math.min(90, Math.floor(innerWidth/16));
      P=[];
      const n = area==='verdad' ? Math.min(46,Math.floor(innerWidth/26)) : base;
      for(let i=0;i<n;i++) P.push(spawn(true));
    }
    function spawn(init){
      const p={};
      if(area==='escudo'){ // embers rising
        p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,30*DPR); p.vy=-rand(.15,.5)*DPR; p.sway=rand(.4,1.2); p.ph=rand(0,6.28); p.r=rand(.9,2.7)*DPR; p.a=rand(.16,.40);
      } else if(area==='valor'){ // value rising (gold motes + sparkle)
        p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,20*DPR); p.vy=-rand(.25,.7)*DPR; p.r=rand(.9,2.6)*DPR; p.a=rand(.15,.38); p.spark=Math.random()<.2; p.ph=rand(0,6.28);
      } else if(area==='futuro'){ // monte-carlo flow L->R
        p.x=init?rand(0,W):-rand(0,40*DPR); p.y=rand(0,H); p.base=p.y; p.vx=rand(.4,1.1)*DPR; p.amp=rand(8,40)*DPR; p.freq=rand(.002,.006); p.ph=rand(0,6.28); p.r=rand(.8,2)*DPR; p.a=rand(.12,.32);
      } else if(area==='pyme'){ // leaves/seeds drifting up
        p.x=rand(0,W); p.y=init?rand(0,H):H+rand(0,30*DPR); p.vy=-rand(.18,.5)*DPR; p.sway=rand(.6,1.6); p.ph=rand(0,6.28); p.rot=rand(0,6.28); p.vr=rand(-.02,.02); p.r=rand(2.8,6)*DPR; p.a=rand(.15,.36);
      } else { // verdad network + app dust
        p.x=rand(0,W); p.y=rand(0,H); p.vx=rand(-.25,.25)*DPR; p.vy=rand(-.25,.25)*DPR; p.r=rand(1.2,2.6)*DPR; p.a=rand(.18,.40);
      }
      return p;
    }

    function frame(){
      t+=1; ctx.clearRect(0,0,W,H);

      if(area==='verdad'){ // constellation / audit links
        const D=120*DPR;
        for(let i=0;i<P.length;i++){ const p=P[i]; p.x+=p.vx; p.y+=p.vy;
          if(p.x<0||p.x>W) p.vx*=-1; if(p.y<0||p.y>H) p.vy*=-1;
        }
        for(let i=0;i<P.length;i++) for(let j=i+1;j<P.length;j++){
          const a=P[i],bb=P[j], dx=a.x-bb.x, dy=a.y-bb.y, d=Math.hypot(dx,dy);
          if(d<D){ ctx.strokeStyle=col(0.15*(1-d/D)); ctx.lineWidth=1*DPR; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(bb.x,bb.y); ctx.stroke(); }
        }
        for(const p of P){ ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill(); }
      }
      else if(area==='futuro'){ // trajectories
        for(const p of P){ p.x+=p.vx; p.y=p.base+Math.sin(p.x*p.freq+p.ph)*p.amp;
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill();
          // faint trailing dot
          ctx.beginPath(); ctx.arc(p.x-6*DPR,p.base+Math.sin((p.x-6*DPR)*p.freq+p.ph)*p.amp,p.r*.6,0,6.28); ctx.fillStyle=col(p.a*.4); ctx.fill();
          if(p.x>W+20*DPR) Object.assign(p,spawn(false));
        }
      }
      else if(area==='pyme'){ // leaves
        for(const p of P){ p.ph+=.01; p.rot+=p.vr; p.y+=p.vy; p.x+=Math.sin(p.ph)*p.sway*DPR*.3;
          ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.ellipse(0,0,p.r,p.r*.5,0,0,6.28); ctx.fillStyle=col(p.a); ctx.fill();
          ctx.restore();
          if(p.y<-20*DPR) Object.assign(p,spawn(false));
        }
      }
      else if(area==='escudo'){ // embers
        for(const p of P){ p.ph+=.03; p.y+=p.vy; p.x+=Math.sin(p.ph)*p.sway*DPR*.25;
          const tw=p.a*(0.6+0.4*Math.sin(p.ph*1.7));
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(tw); ctx.fill();
          if(p.y<-10*DPR) Object.assign(p,spawn(false));
        }
      }
      else if(area==='valor'){ // rising gold + sparkles
        for(const p of P){ p.y+=p.vy; p.ph+=.05;
          if(p.spark){ const s=p.r*1.6; const tw=p.a*(0.5+0.5*Math.sin(p.ph));
            ctx.strokeStyle=col2(tw); ctx.lineWidth=1*DPR;
            ctx.beginPath(); ctx.moveTo(p.x-s,p.y); ctx.lineTo(p.x+s,p.y); ctx.moveTo(p.x,p.y-s); ctx.lineTo(p.x,p.y+s); ctx.stroke();
          } else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill(); }
          if(p.y<-10*DPR) Object.assign(p,spawn(false));
        }
      }
      else { // app dust
        for(const p of P){ p.x+=p.vx; p.y+=p.vy;
          if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fillStyle=col(p.a); ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    }
    resize(); addEventListener('resize', resize); frame();
  }

  document.addEventListener('DOMContentLoaded', function(){
    const active = document.body.getAttribute('data-area');
    const eh = document.getElementById('ehead');
    if(eh){ eh.innerHTML = header(active); }
    if(window.lucide) lucide.createIcons();
    if(typeof window.renderCharts === 'function') window.renderCharts();
    setupMotion();
    if(window.runFX){ window.runFX({}); }
    else if(!document.querySelector('script[data-fx-engine]')){
      var s=document.createElement('script'); s.src='assets/fx.js'; s.setAttribute('data-fx-engine','');
      document.body.appendChild(s);
    }
  });
})();
