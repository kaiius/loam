// Loam art-pass verification: distinctness, affect, motion, determinism.
// Usage: node probes/material-art-verify.mjs [outdir]
// Renders tight portraits and asserts:
//   1. three genome-distinct founders render visibly different (pixel diff)
//   2. one founder's face/posture changes across forced affect states
//   3. gait frames at different ticks differ; same tick renders byte-identical
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import { createMaterialWorld, tickMaterialWorldM2, spawnMaterialCreature } from '../src/material/index.js';
import { portraitFor } from '../src/material/portrait.js';
import { renderWorldView } from '../src/material/render.js';
import { CELL_PX } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';

const outdir = process.argv[2] || '/home/hatch/workspace/canopy-v020/previews/material-art';
mkdirSync(outdir, { recursive: true });
const W = 1440, H = 810;
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) failures++;
};

function renderSvg(mw, c, tick, view) {
  const ctx = new SvgCtx(W, H);
  renderWorldView(ctx, mw, view, {
    creature: { x: c.x, y: c.y, facing: c.facing, drawing: portraitFor(c, tick) },
  });
  return ctx.toSVG();
}
function toPng(name, svg) {
  const svgPath = `${outdir}/${name}.svg`, pngPath = `${outdir}/${name}.png`;
  writeFileSync(svgPath, svg);
  try {
    execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='${svgPath}', write_to='${pngPath}', output_width=1440, output_height=810)
"`, { stdio: 'pipe' });
  } catch { console.log('cairosvg failed for', name); }
}
function tightView(mw, c) {
  const vw = W / 8, vh = H / 8; // zoom 8: the animal fills the frame
  const cx = Math.max(0, Math.min(mw.cols * CELL_PX - vw, c.x - vw / 2));
  const cy = Math.max(0, Math.min(mw.rows * CELL_PX - vh, c.y - H * 0.06 - vh / 2));
  return { x: cx, y: cy, w: vw, h: vh };
}
// crude visual-difference: fraction of differing chars in the svg body
function svgDiff(a, b) {
  const n = Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d / n;
}

// --- 1. distinctness: one plain, one spots, one stripes, different hues ---
const mw = createMaterialWorld(7, 1);
mw.tick = 600;
const rng = createRng(99);
const wants = [
  (p) => p.pattern === 'plain' && p.hueDeg > 10 && p.hueDeg < 50,
  (p) => p.pattern === 'spots',
  (p) => p.pattern === 'stripes',
];
const founders = [];
for (const want of wants) {
  let c = null;
  for (let t = 0; t < 200 && !c; t++) {
    const cand = spawnMaterialCreature(mw, randomGenome(rng, {}), 200 + founders.length * 300, 400);
    if (want(cand.body.pheno)) c = cand;
  }
  if (!c) c = spawnMaterialCreature(mw, randomGenome(rng, {}), 200 + founders.length * 300, 400);
  c.lastAction = 7; // wander — neutral walking pose
  founders.push(c);
}
// let gravity settle them onto the ground before portraiture
for (let t = 0; t < 150; t++) tickMaterialWorldM2(mw);
for (const c of founders) c.lastAction = 7;
console.log('grounded:', founders.map(c => c.grounded).join(','));
const svgs = founders.map((c, i) => {
  const s = renderSvg(mw, c, 600, tightView(mw, c));
  toPng(`art-founder-${i}`, s);
  return s;
});
founders.forEach((c, i) => console.log(
  `founder ${i}: pattern=${c.body.pheno.pattern} hue=${c.body.pheno.hueDeg.toFixed(0)} ` +
  `ear=${c.body.pheno.earShape} eye=${c.body.pheno.eyeSize.toFixed(2)} tail=${c.body.pheno.tailLength.toFixed(2)}`));
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
  const d = svgDiff(svgs[i], svgs[j]);
  check(`founders ${i} vs ${j} visibly distinct`, d > 0.02, `svg diff ${(d * 100).toFixed(1)}%`);
}

// --- 2. affect sequence: one animal, four inner states ---
const subj = founders[0];
const states = [
  ['content', () => { subj.chem.fear = 0; subj.chem.fatigue = 0.2; subj.chem.bloodSugar = 0.85; subj.lastReward = 0.4; subj.lastAction = 7; }],
  ['fear', () => { subj.chem.fear = 0.9; subj.chem.fatigue = 0.2; subj.lastAction = 5; }],
  ['exhausted', () => { subj.chem.fear = 0; subj.chem.fatigue = 0.95; subj.chem.bloodSugar = 0.8; subj.lastAction = 7; }],
  ['eating', () => { subj.chem.fear = 0; subj.chem.fatigue = 0.2; subj.chem.bloodSugar = 0.3; subj.lastAction = 1; }],
];
const affSvgs = states.map(([name, force]) => {
  force();
  const p = portraitFor(subj, 600);
  const s = renderSvg(mw, subj, 600, tightView(mw, subj));
  toPng(`art-affect-${name}`, s);
  return { name, s, pose: p.pose, affect: p.affect };
});
affSvgs.forEach(({ name, affect, pose }) => console.log(
  `affect ${name}: dominant=${affect.dominant} eyeOpen=${pose.eyeOpenNow.toFixed(2)} crouch=${pose.crouch.toFixed(2)} earBack=${pose.earBack.toFixed(2)}`));
const [cont, fear, exh] = affSvgs;
check('fear reads on the face', fear.pose.eyeOpenNow > cont.pose.eyeOpenNow && fear.pose.earBack > cont.pose.earBack);
check('exhaustion reads on the posture', exh.pose.eyeOpenNow < cont.pose.eyeOpenNow && exh.pose.crouch > cont.pose.crouch);
check('affect frames differ', svgDiff(cont.s, fear.s) > 0.01 && svgDiff(cont.s, exh.s) > 0.01);

// --- 3. motion + determinism ---
subj.chem.fear = 0; subj.chem.fatigue = 0.2; subj.chem.bloodSugar = 0.85; subj.lastAction = 7;
const f1 = renderSvg(mw, subj, 600, tightView(mw, subj));
const f2 = renderSvg(mw, subj, 608, tightView(mw, subj));
const f1b = renderSvg(mw, subj, 600, tightView(mw, subj));
check('gait moves between ticks', svgDiff(f1, f2) > 0.005, `diff ${(svgDiff(f1, f2) * 100).toFixed(2)}%`);
check('same tick renders byte-identical', f1 === f1b);
toPng('art-gait-a', f1); toPng('art-gait-b', f2);

// dig + climb poses render
subj.lastAction = 19; // dig
toPng('art-pose-dig', renderSvg(mw, subj, 620, tightView(mw, subj)));
subj.lastAction = 9; // climb
toPng('art-pose-climb', renderSvg(mw, subj, 620, tightView(mw, subj)));
subj.lastAction = 2; // sleep
const sleepSvg = renderSvg(mw, subj, 620, tightView(mw, subj));
toPng('art-pose-sleep', sleepSvg);
check('sleep pose differs from walk', svgDiff(f1, sleepSvg) > 0.01);

console.log(failures === 0 ? 'ALL ART CHECKS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
