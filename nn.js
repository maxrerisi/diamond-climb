// Agent: tiny MLP policy + headless episode runner + fitness. DOM-free (browser, worker, Node).
(function (root) {
  'use strict';
  const Engine = root.Engine || (typeof require !== 'undefined' ? require('./engine') : null);
  const { C, Game } = Engine;

  // Network shape from config: enabled inputs -> hidden layers -> 3 actions (none, left, right).
  function makeNet(cfg) {
    const inputs = [];
    for (let i = 0; i < C.OBS_SIZE; i++) if (cfg.features[i]) inputs.push(i);
    const sizes = [inputs.length];
    for (const h of cfg.hidden) if (h > 0) sizes.push(h);
    sizes.push(3);
    let nParams = 0;
    const layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      layers.push({ nIn, nOut, w: nParams, b: nParams + nIn * nOut });
      nParams += nIn * nOut + nOut;
    }
    const acts = sizes.map((n) => new Float32Array(n)); // activations per layer (reused)
    const probes = inputs.some((i) => i >= C.OBS_BASE);
    return { inputs, sizes, layers, nParams, acts, relu: cfg.activation === 'relu', obs: new Float32Array(C.OBS_SIZE),
      scratch: probes ? new Game(0) : null };
  }

  // Forward pass on genome `g` (Float32Array) at offset `off`. Returns argmax action; activations left in net.acts.
  function forward(net, g, off, obs) {
    const a0 = net.acts[0], inp = net.inputs;
    for (let i = 0; i < inp.length; i++) a0[i] = obs[inp[i]];
    const L = net.layers, last = L.length - 1;
    for (let l = 0; l <= last; l++) {
      const { nIn, nOut, w, b } = L[l], x = net.acts[l], y = net.acts[l + 1];
      for (let o = 0; o < nOut; o++) {
        let sum = g[off + b + o];
        const row = off + w + o * nIn;
        for (let i = 0; i < nIn; i++) sum += g[row + i] * x[i];
        y[o] = l === last ? sum : (net.relu ? (sum > 0 ? sum : 0) : Math.tanh(sum));
      }
    }
    const out = net.acts[last + 1];
    let best = 0;
    if (out[1] > out[best]) best = 1;
    if (out[2] > out[best]) best = 2;
    return best;
  }

  // Xavier-ish random init for one genome.
  function initGenome(net, g, off, randn) {
    for (const { nIn, nOut, w, b } of net.layers) {
      const s = 1 / Math.sqrt(nIn);
      for (let i = 0; i < nIn * nOut; i++) g[off + w + i] = randn() * s;
      for (let o = 0; o < nOut; o++) g[off + b + o] = randn() * 0.1;
    }
  }

  // Stats written per genome by evaluate(). Indices into a STATS-wide row.
  // D_TIMEOUT counts every episode ending alive (stalled or capped); CAPPED counts only those cut by the tick budget.
  const S = { FIT: 0, SCORE: 1, MAXSCORE: 2, TICKS: 3, TAPS: 4, HEIGHT: 5, D_TIMEOUT: 6, D_BAR: 7, D_SQUARE: 8, D_FELL: 9, CAPPED: 10 };
  const STATS = 11;

  // Plays one episode. Returns ticks simulated; fills `res` = {score, ticks, taps, height, cause}.
  function playEpisode(game, net, g, off, seed, ev, res) {
    game.reset(seed);
    const obs = net.obs, k = ev.decisionInterval | 0 || 1, maxTicks = ev.maxTicks;
    const stall = ev.stallTicks > 0 ? ev.stallTicks : Infinity;
    let taps = 0, steps = 0, minY = game.y, lastScore = 0, lastProgress = 0;
    const y0 = game.y;
    while (game.alive && game.tick < maxTicks && steps < maxTicks && steps - lastProgress < stall) {
      let a = 0;
      if (steps % k === 0) {
        game.observe(obs, net.scratch);
        a = forward(net, g, off, obs);
        if (a) taps++;
      }
      game.step(a);
      steps++;
      if (game.y < minY) minY = game.y;
      if (game.score !== lastScore) { lastScore = game.score; lastProgress = steps; }
    }
    res.score = game.score;
    res.ticks = game.tick;
    res.taps = taps;
    res.height = (y0 - minY) / C.LEVEL_DY;
    res.cause = game.alive ? 0 : game.deathCause; // 0 = timeout / stalled / never started
    res.capped = game.alive && (game.tick >= maxTicks || steps >= maxTicks);
    // Partial credit toward the next gap centre (1 = at the gap, 0 = a full level away or more).
    const gs = game.score % C.SLOTS;
    const gdx = game.gapX[gs] + C.GAP_W / 2 - game.x, gdy = game.barY[gs] + C.BAR_H / 2 - game.y;
    const d = Math.sqrt(gdx * gdx + gdy * gdy) / C.LEVEL_DY;
    res.goal = d < 1 ? 1 - d : 0;
    return steps;
  }

  function fitnessOf(res, ev) {
    const f = ev.fitness;
    return f.score * res.score + (f.goal || 0) * res.goal + f.height * res.height + f.time * (res.ticks / 1000)
      - f.tap * (res.taps / 100) - (f.death[res.cause] || 0);
  }

  // Evaluate `count` genomes packed in `genomes`. seedFor(genomeIdx, episode) -> seed.
  // Writes STATS floats per genome into `out`. Returns total steps simulated.
  function evaluate(net, genomes, count, ev, seedFor, out, game) {
    game = game || new Game(0);
    const res = { score: 0, ticks: 0, taps: 0, height: 0, cause: 0, goal: 0, capped: false };
    const M = ev.episodes;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const off = i * net.nParams, r = i * STATS;
      for (let j = 0; j < STATS; j++) out[r + j] = 0;
      for (let e = 0; e < M; e++) {
        total += playEpisode(game, net, genomes, off, seedFor(i, e), ev, res);
        out[r + S.FIT] += fitnessOf(res, ev) / M;
        out[r + S.SCORE] += res.score / M;
        if (res.score > out[r + S.MAXSCORE]) out[r + S.MAXSCORE] = res.score;
        out[r + S.TICKS] += res.ticks / M;
        out[r + S.TAPS] += res.taps / M;
        out[r + S.HEIGHT] += res.height / M;
        out[r + S.D_TIMEOUT + res.cause] += 1;
        if (res.capped) out[r + S.CAPPED] += 1;
      }
    }
    return total;
  }

  // Deterministic per-(generation, genome, episode) seed.
  function hashSeed(a, b, c) {
    let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x632BE5AB, 0xC2B2AE35) ^ Math.imul(c + 0x27D4EB2F, 0x165667B1);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
    return h >>> 0;
  }

  // seedMode: 'shared' (same M seeds for all genomes, new each gen), 'fixed' (same seeds forever), 'random' (per genome).
  // idOf(i) maps a slice index to the genome's population index (or pass a start offset), so a genome
  // replays the same levels however the population is sliced (needed for racing re-runs).
  function seedFn(mode, base, gen, idOf) {
    if (typeof idOf === 'number') { const start = idOf; idOf = (i) => start + i; }
    if (mode === 'fixed') return (i, e) => hashSeed(base, 0, e);
    if (mode === 'random') return (i, e) => hashSeed(base, gen, idOf(i) * 1000 + e + 1);
    return (i, e) => hashSeed(base, gen, e);
  }

    // Racing schedule: tick budgets base, base*grow, ... ending exactly at cap.
  function raceBudgets(base, grow, cap) {
    const out = [];
    let t = Math.min(base, cap);
    while (t < cap && grow > 1) { out.push(Math.round(t)); t *= grow; }
    out.push(cap);
    return out;
  }

  const api = { makeNet, forward, initGenome, playEpisode, fitnessOf, evaluate, seedFn, hashSeed, raceBudgets, S, STATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NN = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
