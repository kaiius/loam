#!/usr/bin/env python3
# Generates previews/weboflife-2026-10-01.html from /tmp/weboflife-frames.json
import json

d = json.load(open('/tmp/weboflife-frames.json'))
meta = d['meta']
frames_json = json.dumps(d['frames'])
platforms_json = json.dumps(meta['platforms'])
beats_json = json.dumps(meta['beats'])

html = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Web of Life — v0.22 preview</title>
<style>
body{margin:0;background:#0a140d;color:#f2ecdc;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:18px}
h1{font-size:19px;margin:0 0 4px}
.sub{font-size:13px;opacity:.75;max-width:700px;text-align:center;margin:0 0 10px}
#wrap{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;justify-content:center}
canvas{border:1px solid #2c4a33;border-radius:8px;background:#0e1a12}
#side{width:300px;font-size:13px}
#side h3{font-size:13px;margin:10px 0 4px;color:#cfe3b8}
#controls{display:flex;gap:8px;margin:0 0 8px;flex-wrap:wrap}
button{background:#1d3524;color:#f2ecdc;border:1px solid #3a5a40;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}
button:hover{background:#284a30}
#hud{font-size:13px;line-height:1.7;background:#101f15;border:1px solid #2c4a33;border-radius:8px;padding:8px 10px;margin-bottom:8px}
#hud b{color:#ffe9a8}
#feed{max-height:220px;overflow-y:auto;background:#101f15;border:1px solid #2c4a33;border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.6}
#feed .ev{margin-bottom:4px}
#feed .t{color:#9db98a}
#legend{font-size:12.5px;line-height:1.8}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.foot{font-size:12px;opacity:.65;max-width:700px;text-align:center;margin:14px 0 0;line-height:1.6}
.foot .gap{color:#f0b429}
</style></head><body>
<h1>v0.22 &ldquo;Web of Life&rdquo; &mdash; the cleanup crew</h1>
<p class="sub">A jungle clearing, 350 simulated seconds. An elder dies, the vultures come down, the midden beetles graze, and the soil bacteria bloom. Every movement below was produced by the sim &mdash; nothing is scripted.</p>
<div id="wrap">
<div>
<canvas id="cv" width="700" height="500"></canvas>
<div id="controls">
<button id="pp">&#10074;&#10074; pause</button>
<button id="spd">speed: 1&times;</button>
<button id="bac">bacteria overlay: on</button>
<button id="rst">restart</button>
</div>
</div>
<div id="side">
<div id="hud"></div>
<h3>What&rsquo;s happening</h3>
<div id="feed"></div>
<h3>Legend</h3>
<div id="legend"></div>
</div>
</div>
<p class="foot">
Staged scenario, fixed seed <b>20261001</b>, cat seed <b>117</b> &mdash; the cast was hand-placed and fruit/waste seeded, then the sim ran 3,500 ticks headless; 351 frames captured every 10 ticks.<br>
<span class="gap">v0.22.1:</span> the bite verb now executes &mdash; at t=94.3s the cat kills Moss (cause: wounds). The hunt is emergent: hunger gates the strike via the new <i>instHungerBite</i> gene, the cat stalks via the distance wire, and the kill falls out of the mechanics. No scripts, no cheats.
</p>
<script>
const FRAMES = __FRAMES__;
const PLATFORMS = __PLATFORMS__;
const BEATS = __BEATS__;
const SEED = 20261001;

// viewport: jungle clearing
const VX0=1150, VX1=1850, VY0=340, VY1=860;
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const SX = cv.width/(VX1-VX0), SY = cv.height/(VY1-VY0);
const X = x => (x-VX0)*SX, Y = y => (y-VY0)*SY;

const COLORS = {
  'tanglekin':'#c98a3d', 'jungle-cat':'#e04f2f', 'vulture':'#8a7fb8',
  'beetle-detritivore':'#5fb86a'
};
const NAMES = {
  'tanglekin':'tanglekin (forager)', 'jungle-cat':'jungle cat',
  'vulture':'vulture (soarer)', 'beetle-detritivore':'midden beetle'
};
const platById = {};
PLATFORMS.forEach(p=>platById[p.i]=p);
function platY(pi){ const p=platById[pi]; return p?p.y:800; }

let frame = 0, playing = true, speed = 1, showBac = true;
const SPEEDS = [1,2,4,8];
let speedIdx = 0;

// event feed content (from real beats)
const EVENTS = [];
BEATS.deaths.forEach(d=>EVENTS.push({t:d.t, html:`<span class="t">[${d.t.toFixed(0)}s]</span> &#9760; <b>${d.name}</b> dies of ${d.cause} &mdash; a corpse becomes food`}));
if(BEATS.bloomT) EVENTS.push({t:BEATS.bloomT, html:`<span class="t">[${BEATS.bloomT.toFixed(0)}s]</span> &#129440; <b>bacteria bloom</b> in the jungle soil (biomass &gt; 2.0)`});
EVENTS.push({t:0, html:`<span class="t">[0s]</span> Foragers in the branches, a hungry cat on the ground, the midden crew at work`});
EVENTS.push({t:52, html:`<span class="t">[52s]</span> The vultures converge on Ash&rsquo;s corpse`});
EVENTS.push({t:66, html:`<span class="t">[66s]</span> Corpse cleared &mdash; scavengers 1, rot 0`});
EVENTS.sort((a,b)=>a.t-b.t);
let feedShown = 0;

function draw(){
  const f = FRAMES[frame];
  ctx.clearRect(0,0,cv.width,cv.height);
  // bacteria overlay on the ground
  if(showBac){
    const b = f.bacteria; // 1.0 founder, 2.0 bloom, 3.0 max
    const inten = Math.min(1, Math.max(0,(b-1)/2));
    const g = ctx.createLinearGradient(0,Y(800),0,Y(860));
    g.addColorStop(0, `rgba(90,200,110,${0.05+0.45*inten})`);
    g.addColorStop(1, 'rgba(90,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(X(1200), Y(795), X(1800)-X(1200), Y(860)-Y(795));
  }
  // platforms (jungle ones)
  PLATFORMS.forEach(p=>{
    if(p.x1<1100||p.x2>1900||p.y>VY1||p.y<VY0) return;
    ctx.fillStyle = p.kind==='branch' ? '#4a7a3f' : '#3d5a35';
    const h = p.kind==='branch'?5:10;
    ctx.fillRect(X(p.x1), Y(p.y)-h/2, X(p.x2)-X(p.x1), h);
  });
  // waste as speckles on the ground
  const w = f.waste;
  if(w>0.2){
    ctx.fillStyle = 'rgba(160,120,60,0.5)';
    const n = Math.min(40, Math.floor(w*6));
    for(let i=0;i<n;i++){
      const wx = 1220 + ((i*173)%560), wy = 795 + ((i*97)%30);
      ctx.fillRect(X(wx), Y(wy), 2, 2);
    }
  }
  // corpses
  f.corpses.forEach(c=>{
    const r = 4 + c.amt*6;
    ctx.fillStyle = 'rgba(140,30,30,0.9)';
    ctx.beginPath(); ctx.arc(X(c.x), Y(platY(c.pi))-4, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#f2ecdc'; ctx.font = '10px sans-serif';
    ctx.fillText('\u2620', X(c.x)-5, Y(platY(c.pi))-r-4);
  });
  // creatures
  f.creatures.forEach(c=>{
    if(!c.alive) return;
    const py = platY(c.pi)-8;
    const col = COLORS[c.sp]||'#fff';
    const big = c.sp==='jungle-cat'||c.sp==='vulture';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(X(c.x), Y(py), big?7:5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    if(c.sp==='jungle-cat'||c.sp==='vulture'){
      ctx.fillStyle = '#f2ecdc'; ctx.font = '10px sans-serif';
      const tag = c.sp==='jungle-cat'?'cat':(c.label.includes('corpse')||c.label.includes('eating')?'\u25cf':'');
      if(tag) ctx.fillText(tag, X(c.x)-8, Y(py)-12);
    }
  });
  // HUD
  document.getElementById('hud').innerHTML =
    `<b>t+</b>${f.t.toFixed(0)}s &nbsp; <b>soil bacteria</b> ${f.bacteria.toFixed(2)}${f.bacteria>=2?' &#129440; BLOOM':''} &nbsp; <b>waste</b> ${f.waste.toFixed(1)}<br>`+
    `<b>alive</b> ${f.creatures.filter(c=>c.alive).length}/${f.creatures.length} &nbsp; <b>corpses</b> ${f.corpses.length}`;
  // feed
  const feed = document.getElementById('feed');
  while(feedShown<EVENTS.length && EVENTS[feedShown].t<=f.t){
    const div=document.createElement('div'); div.className='ev'; div.innerHTML=EVENTS[feedShown].html;
    feed.appendChild(div); feed.scrollTop=feed.scrollHeight; feedShown++;
  }
  window.__weboflife = {frame, playing, n:FRAMES.length, t:f.t};
}

document.getElementById('legend').innerHTML = Object.keys(COLORS).map(k=>
  `<div><span class="dot" style="background:${COLORS[k]}"></span>${NAMES[k]}</div>`).join('')+
  `<div><span class="dot" style="background:rgba(140,30,30,0.9)"></span>corpse (food)</div>`+
  `<div><span class="dot" style="background:rgba(90,200,110,0.6)"></span>soil bacteria (overlay)</div>`;

const pp=document.getElementById('pp'), spd=document.getElementById('spd'),
      bac=document.getElementById('bac'), rst=document.getElementById('rst');
pp.onclick=()=>{playing=!playing; pp.innerHTML=playing?'&#10074;&#10074; pause':'&#9654; play';};
spd.onclick=()=>{speedIdx=(speedIdx+1)%SPEEDS.length; speed=SPEEDS[speedIdx]; spd.innerHTML='speed: '+speed+'&times;';};
bac.onclick=()=>{showBac=!showBac; bac.innerHTML='bacteria overlay: '+(showBac?'on':'off');};
rst.onclick=()=>{frame=0; feedShown=0; document.getElementById('feed').innerHTML='';};

let acc=0, last=performance.now();
function tick(now){
  const dt=(now-last)/1000; last=now;
  if(playing){
    acc+=dt*speed;
    const step=1/12; // 12 fps base
    while(acc>step){ acc-=step; frame=Math.min(FRAMES.length-1, frame+1); }
  }
  draw();
  requestAnimationFrame(tick);
}
draw();
requestAnimationFrame(tick);
</script></body></html>
"""

html = html.replace('__FRAMES__', frames_json).replace('__PLATFORMS__', platforms_json).replace('__BEATS__', beats_json)
open('/home/hatch/workspace/canopy-v020/previews/weboflife-2026-10-01.html','w').write(html)
print('wrote', len(html)//1024, 'KB')
