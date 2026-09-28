// Headless learning check: single-threaded evolution should improve over generations.
//   node evo-check.js [generations=40]
'use strict';
const assert = require('assert');
const { Game } = require('./engine');
const NN = require('./nn');
const { Evolver } = require('./evo');

const cfg = {
  features: new Array(26).fill(true), hidden: [16], activation: 'tanh',
  popSize: 100, initSigma: 0.3, sigmaMin: 0.01, sigmaMax: 0.5, tauScale: 1, mutRate: 0.3,
  elites: 4, tournament: 4, crossover: 0.2, stagnation: 0, boost: 1.3, immigrants: 0.05,
  eval: { episodes: 4, maxTicks: 3000, stallTicks: 600, decisionInterval: 6, seedMode: 'shared', seedBase: 7,
    fitness: { score: 10, goal: 8, height: 0, time: 1, tap: 0, death: [0, 0, 0, 1] } },
};
if (process.env.CFG) { const o = JSON.parse(process.env.CFG); for (const k in o) { if (k in cfg.eval) cfg.eval[k] = o[k]; else cfg[k] = o[k]; } }
const G = parseInt(process.argv[2], 10) || 40;
const net = NN.makeNet(cfg), evo = new Evolver(net, cfg, 1), game = new Game(0);
const stats = new Float32Array(cfg.popSize * NN.STATS), fit = new Float32Array(cfg.popSize);
const bests = [];
const t0 = Date.now();
let ticks = 0;
for (let g = 0; g < G; g++) {
  ticks += NN.evaluate(net, evo.pop, cfg.popSize, cfg.eval, NN.seedFn('shared', 7, g, 0), stats, game);
  let best = 0, mean = 0;
  for (let i = 0; i < cfg.popSize; i++) {
    fit[i] = stats[i * NN.STATS + NN.S.FIT];
    best = Math.max(best, stats[i * NN.STATS + NN.S.SCORE]);
    mean += stats[i * NN.STATS + NN.S.SCORE] / cfg.popSize;
  }
  bests.push(best);
  evo.step(fit);
  if (g % 5 === 0 || g === G - 1) console.log(`gen ${g}: best mean-score ${best.toFixed(2)}  pop mean ${mean.toFixed(2)}  sigma ${evo.meanSigma().toFixed(3)}`);
}
const s = (Date.now() - t0) / 1000;
console.log(`${G} gens, ${(ticks / 1e6).toFixed(1)}M steps in ${s.toFixed(1)}s (${(ticks / s / 1e6).toFixed(2)}M steps/s single-thread)`);
const early = bests[0], late = Math.max(...bests.slice(-10));
assert(late > early, `no improvement: gen0 ${early} vs late ${late}`);

// Cache round-trip: restore reproduces the exact same next generation.
const snap = evo.serialize(), clone = Evolver.restore(net, cfg, JSON.parse(JSON.stringify({ ...snap, pop: Array.from(snap.pop), sigma: Array.from(snap.sigma) })));
evo.step(fit); clone.step(fit);
assert.deepStrictEqual(Array.from(clone.pop), Array.from(evo.pop));
console.log(`improved ${early.toFixed(2)} -> ${late.toFixed(2)}; restore round-trip ✓`);
