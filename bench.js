// Headless benchmark + physics checks.
//   node bench.js [games=20000]     throughput + determinism
//   node bench.js --check           physics sanity checks
'use strict';
const assert = require('assert');
const { C, Game, mulberry32 } = require('./engine');

// Simple greedy policy: aim at the next gap, tap when falling below it.
function policy(g, obs) {
  g.observe(obs);
  const belowBar = -obs[10] * C.W, gapRelX = obs[5] * C.W; // distance under bar bottom
  const aligned = Math.abs(gapRelX) < 30;
  if (g.vy > 0 && (belowBar > (aligned ? 20 : 110) || obs[3] > 0.8)) return gapRelX < 0 ? 1 : 2;
  return 0;
}

function run(games, seed0, useRandom) {
  const g = new Game(0), obs = new Float32Array(C.OBS_SIZE), rng = mulberry32(seed0);
  let ticks = 0, total = 0, maxScore = 0;
  for (let i = 0; i < games; i++) {
    g.reset(seed0 + i);
    g.step(1 + (i & 1));
    while (g.alive && g.tick < 20000) {
      const a = useRandom ? (rng() < 0.06 ? 1 + (rng() < 0.5 ? 1 : 0) : 0) : policy(g, obs);
      g.step(a);
    }
    ticks += g.tick; total += g.score; if (g.score > maxScore) maxScore = g.score;
  }
  return { ticks, total, maxScore };
}

function check() {
  const g = new Game(1);
  // Frozen until the first tap.
  for (let i = 0; i < 100; i++) g.step(0);
  assert.strictEqual(g.y, C.H / 2);

  // Tap arc: vy set, apex ~127 units up after ~28 ticks.
  g.step(2);
  const y0 = g.y - g.vy; // position before the tap tick
  let minY = g.y, apexTick = 1;
  for (let t = 2; t < 60; t++) { g.step(0); if (g.y < minY) { minY = g.y; apexTick = t; } }
  console.log(`apex rise ${(y0 - minY).toFixed(1)} units after ${apexTick} ticks (expect ~127, ~28)`);
  assert(Math.abs(y0 - minY - 127) < 6 && Math.abs(apexTick - 28) <= 1);

  // Tap sets (not adds) vy.
  g.reset(2); g.step(1); for (let i = 0; i < 40; i++) g.step(0);
  g.step(1); assert(Math.abs(g.vy - (C.TAP_VY + C.GRAVITY)) < 1e-9);

  // Sticky wall: constant slide, no vx, upward motion killed.
  g.reset(3); g.alive = true; g.started = true; g.x = C.R + 1; g.vx = -C.TAP_VX; g.vy = -8;
  g.lvl.fill(-1); // no obstacles
  g.step(0);
  assert.strictEqual(g.onWall, -1); assert.strictEqual(g.vx, 0);
  const ys = []; for (let i = 0; i < 10; i++) { g.step(0); ys.push(g.y); }
  for (let i = 1; i < ys.length; i++) assert(Math.abs(ys[i] - ys[i - 1] - C.WALL_SLIDE) < 1e-9);
  g.step(2); assert(g.vx > 0 && g.vy < 0 && g.onWall === 0);
  console.log('wall slide constant at', C.WALL_SLIDE);

  // Re-crossing a bar never re-scores.
  g.reset(4); g.started = true;
  const s0 = 0, by = g.barY[s0];
  g.hasSq.fill(0); g.x = g.gapX[s0] + C.GAP_W / 2; g.vx = 0;
  g.y = by + C.BAR_H + 30; g.vy = 0;
  // drop other bars out of the way so we can move freely
  for (let s = 1; s < C.SLOTS; s++) g.lvl[s] = -1;
  const moveTo = (y) => { g.y = y - g.vy - C.GRAVITY; g.step(0); };
  moveTo(by - 30); assert.strictEqual(g.score, 1);
  moveTo(by + C.BAR_H + 30); moveTo(by - 30); assert.strictEqual(g.score, 1);
  console.log('re-crossing does not re-score');

  // Camera never moves down.
  g.reset(5); g.step(1); let cam = g.camY;
  while (g.alive) { g.step(g.tick % 17 === 0 ? 2 : 0); assert(g.camY <= cam); cam = g.camY; }
  // Observations are always finite.
  const obs = new Float32Array(C.OBS_SIZE);
  for (let seed = 0; seed < 50; seed++) {
    g.reset(seed); g.step(1);
    while (g.alive) { g.observe(obs); for (const v of obs) assert(Number.isFinite(v)); g.step(policy(g, obs)); if (g.tick > 5000) break; }
  }
  console.log('all checks passed');
}

if (process.argv.includes('--check')) { check(); process.exit(0); }

const games = parseInt(process.argv[2], 10) || 20000;
for (const [name, rand] of [['greedy', false], ['random', true]]) {
  const t0 = process.hrtime.bigint();
  const r = run(games, 12345, rand);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const again = run(Math.min(games, 500), 12345, rand), first = run(Math.min(games, 500), 12345, rand);
  assert.deepStrictEqual(again, first, 'non-deterministic!');
  console.log(`${name}: ${games} games, ${r.ticks} ticks in ${ms.toFixed(0)} ms = ` +
    `${(r.ticks / ms / 1000).toFixed(2)} M ticks/s | mean score ${(r.total / games).toFixed(2)}, max ${r.maxScore} | deterministic ✓`);
}
