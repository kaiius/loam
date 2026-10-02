// world-weather — climate readout instrument for Canopy.
// Reports the sky as the creatures live it: season phase, temperature (°C),
// moisture, wind — per-column climate field summarized, land vs water split.
// Run: node probes/world-weather.mjs [seed] [ticks]
// Output: JSON summary + one-line human summary.
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';
import { seasonPhase, NC } from '../src/sim/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = parseInt(process.argv[3] || '2000', 10);
const DT = 0.5;

// T-units → °C: T=0 → −10°C, T=1 → 35°C (Whittaker lookup anchor, weather.js).
const toC = (t) => -10 + 45 * t;

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const seasonName = (phase) => SEASONS[Math.floor(((phase % 1) + 1) % 1 * 4) % 4];

const world = bindWorld(createWorld(seed));
populateGenesis(world);
for (let i = 0; i < TICKS; i++) tickWorld(world, DT);

const cl = world.climate;
const n = NC(cl);
const cols = cl.cols;
let sumT = 0, minT = Infinity, maxT = -Infinity, minX = 0, maxX = 0;
let sumCloud = 0, sumSoil = 0, sumRain = 0, sumWind = 0, sumVapor = 0;
let landT = 0, landN = 0, waterT = 0, waterN = 0;
for (let i = 0; i < n; i++) {
  const c = cols[i];
  const x = (i + 0.5) * 100;
  sumT += c.T; sumCloud += c.cloud; sumSoil += c.soil;
  sumRain += c.rain; sumWind += Math.abs(c.windU); sumVapor += c.vapor;
  if (c.T < minT) { minT = c.T; minX = x; }
  if (c.T > maxT) { maxT = c.T; maxX = x; }
  const wf = (cl.waterFrac && cl.waterFrac[i]) || 0;
  if (wf > 0.5) { waterT += c.T; waterN++; } else { landT += c.T; landN++; }
}
const phase = seasonPhase(world);
const out = {
  seed, ticks: TICKS, worldTick: world.tick,
  season: {
    name: seasonName(phase),
    yearFraction: +phase.toFixed(3),
    yearLengthTicks: cl.yearLength,
    seasonSin: +Math.sin(phase * Math.PI * 2).toFixed(3),
  },
  temperatureC: {
    mean: +toC(sumT / n).toFixed(1),
    min: +toC(minT).toFixed(1), minAtX: Math.round(minX),
    max: +toC(maxT).toFixed(1), maxAtX: Math.round(maxX),
    landMean: landN ? +toC(landT / landN).toFixed(1) : null,
    waterMean: waterN ? +toC(waterT / waterN).toFixed(1) : null,
  },
  sky: {
    meanCloud: +(sumCloud / n).toFixed(2),
    meanSoil: +(sumSoil / n).toFixed(2),
    meanRain: +(sumRain / n).toFixed(3),
    meanWindU: +(sumWind / n).toFixed(2),
    meanVapor: +(sumVapor / n).toFixed(2),
    lightningStrikes: cl.lightning.length,
    vents: cl.vents.length,
  },
};
console.log(JSON.stringify(out, null, 2));
const s = out.season, t = out.temperatureC;
console.log(
  `\n${s.name} (year ${(s.yearFraction * 100).toFixed(0)}%) — ` +
  `mean ${t.mean}°C, land ${t.landMean}°C, water ${t.waterMean}°C, ` +
  `range ${t.min}°C→${t.max}°C, cloud ${(out.sky.meanCloud * 100).toFixed(0)}%`
);
