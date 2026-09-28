// Trainer UI: controls, worker pool, generation loop, analytics, live view, caching.
(function () {
  'use strict';
  const { C, Game, OBS_NAMES } = Engine;
  const { Evolver } = Evo;
  const $ = (s) => document.querySelector(s);
  const HC = navigator.hardwareConcurrency || 4;
  const TOP_K = 51; // genomes kept for the live view (champion + up to 50 ghosts)

  // ---------- settings schema ----------
  // reset: true = only applies to a fresh population (architecture / population shape).
  const SCHEMA = [
    { g: 'Run', k: 'workers', label: 'Worker threads', type: 'range', min: 1, max: Math.max(2, HC * 2), step: 1, def: Math.max(1, HC - 1), tip: 'Parallel Web Workers evaluating genomes' },
    { g: 'Run', k: 'pauseHidden', label: 'Pause when tab hidden', type: 'check', def: false },
    { g: 'Population', k: 'popSize', label: 'Population size', type: 'range', min: 10, max: 2000, step: 10, def: 150, reset: true },
    { g: 'Population', k: 'hidden1', label: 'Hidden layer 1', type: 'range', min: 2, max: 64, step: 1, def: 16, reset: true },
    { g: 'Population', k: 'hidden2', label: 'Hidden layer 2 (0 = off)', type: 'range', min: 0, max: 64, step: 1, def: 0, reset: true },
    { g: 'Population', k: 'activation', label: 'Activation', type: 'select', options: ['tanh', 'relu'], def: 'tanh', reset: true },
    { g: 'Population', k: 'initSigma', label: 'Initial σ', type: 'range', min: 0.01, max: 1, step: 0.01, def: 0.3, tip: 'Mutation step size for new / immigrant genomes' },
    { g: 'Evolution', k: 'elites', label: 'Elites kept', type: 'range', min: 0, max: 50, step: 1, def: 4, tip: 'Top genomes copied unchanged' },
    { g: 'Evolution', k: 'tournament', label: 'Tournament size', type: 'range', min: 1, max: 20, step: 1, def: 4, tip: 'Selection pressure' },
    { g: 'Evolution', k: 'crossover', label: 'Crossover rate', type: 'range', min: 0, max: 1, step: 0.05, def: 0.2 },
    { g: 'Evolution', k: 'mutRate', label: 'Per-weight mutation p', type: 'range', min: 0.01, max: 1, step: 0.01, def: 0.3 },
    { g: 'Evolution', k: 'sigmaMin', label: 'σ min', type: 'range', min: 0.001, max: 0.2, step: 0.001, def: 0.01 },
    { g: 'Evolution', k: 'sigmaMax', label: 'σ max', type: 'range', min: 0.05, max: 2, step: 0.05, def: 0.5 },
    { g: 'Evolution', k: 'tauScale', label: 'σ adaptation rate τ', type: 'range', min: 0, max: 3, step: 0.1, def: 1, tip: 'Self-adaptive σ learning rate (× 1/√n). 0 = fixed σ' },
    { g: 'Evolution', k: 'stagnation', label: 'Stagnation window (0 = off)', type: 'range', min: 0, max: 200, step: 5, def: 40, tip: 'Generations without a new best fitness before boosting σ' },
    { g: 'Evolution', k: 'boost', label: 'Stagnation σ boost', type: 'range', min: 1, max: 4, step: 0.1, def: 1.3 },
    { g: 'Evolution', k: 'immigrants', label: 'Immigrants on stagnation', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0.05, tip: 'Fraction of worst genomes replaced by random ones' },
    { g: 'Evaluation', k: 'episodes', label: 'Episodes per genome', type: 'range', min: 1, max: 20, step: 1, def: 4 },
    { g: 'Evaluation', k: 'maxTicks', label: 'Episode cap (start / fixed)', type: 'range', min: 500, max: 50000, step: 500, def: 6000, tip: 'Tick limit per episode. With adaptive cap on, this is the starting value' },
    { g: 'Cap & racing', k: 'capAdaptive', label: 'Adaptive cap', type: 'check', def: true, tip: 'Raise the episode cap when too many top episodes run into it' },
    { g: 'Cap & racing', k: 'capHitFrac', label: 'Grow when capped ≥', type: 'range', min: 0.05, max: 0.9, step: 0.05, def: 0.2, tip: 'Fraction of final-stage episodes ending at the cap that triggers growth' },
    { g: 'Cap & racing', k: 'capGrow', label: 'Cap growth ×', type: 'range', min: 1.1, max: 4, step: 0.1, def: 2 },
    { g: 'Cap & racing', k: 'capMax', label: 'Cap ceiling', type: 'range', min: 10000, max: 1000000, step: 10000, def: 200000 },
    { g: 'Cap & racing', k: 'raceOn', label: 'Racing (successive halving)', type: 'check', def: true, tip: 'Short budget for everyone; only the best still-alive genomes are re-run with bigger budgets' },
    { g: 'Cap & racing', k: 'raceBase', label: 'First-stage budget', type: 'range', min: 250, max: 10000, step: 250, def: 1000 },
    { g: 'Cap & racing', k: 'raceGrow', label: 'Budget growth / stage ×', type: 'range', min: 1.5, max: 8, step: 0.5, def: 2 },
    { g: 'Cap & racing', k: 'raceKeep', label: 'Keep fraction / stage', type: 'range', min: 0.1, max: 0.9, step: 0.05, def: 0.5 },
    { g: 'Evaluation', k: 'stallTicks', label: 'Stall limit (0 = off)', type: 'range', min: 0, max: 5000, step: 50, def: 600, tip: 'End episode if no bar passed within this many ticks' },
    { g: 'Evaluation', k: 'decisionInterval', label: 'Decide every k ticks', type: 'range', min: 1, max: 20, step: 1, def: 6 },
    { g: 'Evaluation', k: 'seedMode', label: 'Level seeds', type: 'select', options: ['shared', 'random', 'fixed'], def: 'shared', tip: 'shared: all genomes play the same new levels each gen · random: each its own · fixed: same levels forever' },
    { g: 'Evaluation', k: 'seedBase', label: 'Seed base', type: 'number', def: 7 },
    { g: 'Fitness', k: 'fScore', label: 'Per bar passed', type: 'range', min: 0, max: 50, step: 0.5, def: 10 },
    { g: 'Fitness', k: 'fGoal', label: 'Closeness to next gap', type: 'range', min: 0, max: 50, step: 0.5, def: 8 },
    { g: 'Fitness', k: 'fHeight', label: 'Per level of height', type: 'range', min: 0, max: 20, step: 0.5, def: 0 },
    { g: 'Fitness', k: 'fTime', label: 'Per 1000 ticks alive', type: 'range', min: 0, max: 20, step: 0.5, def: 1 },
    { g: 'Fitness', k: 'fTap', label: 'Penalty per 100 taps', type: 'range', min: 0, max: 5, step: 0.1, def: 0 },
    { g: 'Fitness', k: 'dStall', label: 'Penalty: stall / timeout', type: 'range', min: 0, max: 20, step: 0.5, def: 0 },
    { g: 'Fitness', k: 'dBar', label: 'Penalty: hit bar', type: 'range', min: 0, max: 20, step: 0.5, def: 0 },
    { g: 'Fitness', k: 'dSquare', label: 'Penalty: hit square', type: 'range', min: 0, max: 20, step: 0.5, def: 0 },
    { g: 'Fitness', k: 'dFell', label: 'Penalty: fell off', type: 'range', min: 0, max: 20, step: 0.5, def: 1 },
    { g: 'Inputs', k: 'features', type: 'features', def: new Array(C.OBS_SIZE).fill(true), reset: true },
    { g: 'Visuals', k: 'ghosts', label: 'Ghosts shown', type: 'range', min: 0, max: 50, step: 1, def: 12 },
    { g: 'Visuals', k: 'speed', label: 'Live speed', type: 'select', options: ['0.25', '0.5', '1', '2', '4', '8', 'max'], def: '1' },
    { g: 'Visuals', k: 'follow', label: 'Camera follows', type: 'select', options: ['champion', 'leader'], def: 'champion' },
    { g: 'Visuals', k: 'source', label: 'Live agents from', type: 'select', options: ['latest gen', 'best ever'], def: 'latest gen' },
    { g: 'Visuals', k: 'sensors', label: 'Show sensor lines', type: 'check', def: true },
    { g: 'Visuals', k: 'probes', label: 'Show lookahead arcs', type: 'check', def: true },
    { g: 'Visuals', k: 'netPanel', label: 'Animate network', type: 'check', def: true },
    { g: 'Visuals', k: 'chartWindow', label: 'Chart window (gens)', type: 'select', options: ['100', '500', '2000', 'all'], def: 'all' },
    { g: 'Visuals', k: 'smooth', label: 'Chart smoothing', type: 'range', min: 0, max: 0.95, step: 0.05, def: 0 },
    { g: 'Cache', k: 'autosave', label: 'Auto-save', type: 'check', def: true },
    { g: 'Cache', k: 'autosaveEvery', label: 'Auto-save every N gens', type: 'range', min: 1, max: 100, step: 1, def: 5 },
  ];
  const RESET_KEYS = SCHEMA.filter((s) => s.reset).map((s) => s.k);
  const DEFAULTS = () => Object.fromEntries(SCHEMA.map((s) => [s.k, Array.isArray(s.def) ? s.def.slice() : s.def]));
  const cfg = DEFAULTS();
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('rl-cfg') || '{}')); } catch (e) {}
  if (!Array.isArray(cfg.features) || cfg.features.length !== C.OBS_SIZE) cfg.features = DEFAULTS().features;
  cfg.liveOn = cfg.liveOn !== false;

  const netCfgOf = (c) => ({ features: c.features.slice(), hidden: [c.hidden1, c.hidden2], activation: c.activation });
  const evoCfgOf = (c) => ({ popSize: c.popSize, initSigma: c.initSigma, sigmaMin: c.sigmaMin, sigmaMax: c.sigmaMax,
    tauScale: c.tauScale, mutRate: c.mutRate, elites: c.elites, tournament: c.tournament, crossover: c.crossover,
    stagnation: c.stagnation, boost: c.boost, immigrants: c.immigrants });
  const evalCfgOf = (c) => ({ episodes: c.episodes, maxTicks: c.maxTicks, stallTicks: c.stallTicks,
    decisionInterval: c.decisionInterval, seedMode: c.seedMode, seedBase: c.seedBase | 0,
    fitness: { score: c.fScore, goal: c.fGoal, height: c.fHeight, time: c.fTime, tap: c.fTap,
      death: [c.dStall, c.dBar, c.dSquare, c.dFell] } });
  const archKeyOf = (c) => JSON.stringify([netCfgOf(c), c.popSize]);

  function persistCfg() { try { localStorage.setItem('rl-cfg', JSON.stringify(cfg)); } catch (e) {} }

  // ---------- UI helpers ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const fmt = Charts.fmt;
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
  }
  // Two-click confirmation on a button (avoids native dialogs).
  function confirmClick(btn, label, action) {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; btn.classList.remove('danger'); action(); return; }
    btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label; btn.classList.add('danger');
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; btn.classList.remove('danger'); } }, 3000);
  }

  // ---------- controls ----------
  const inputs = {};
  function buildControls() {
    const root = $('#controls');
    const groups = {};
    for (const s of SCHEMA) {
      if (!groups[s.g]) {
        const d = document.createElement('details');
        d.className = 'group';
        d.open = ['Run', 'Evolution', 'Evaluation', 'Cap & racing', 'Visuals'].includes(s.g);
        const resetNote = SCHEMA.some((x) => x.g === s.g && x.reset) ? ' <span class="hint">⟲ = needs reset</span>' : '';
        d.innerHTML = `<summary>${s.g}${resetNote}</summary><div class="body"></div>`;
        root.appendChild(d);
        groups[s.g] = d.querySelector('.body');
      }
      const body = groups[s.g];
      if (s.type === 'features') { buildFeatures(body); continue; }
      const row = document.createElement('label');
      row.className = 'row' + (s.type === 'check' ? ' check' : '');
      if (s.tip) row.title = s.tip;
      const name = `<span class="name">${s.label}${s.reset ? '<span class="r">⟲</span>' : ''}</span>`;
      if (s.type === 'range') {
        row.innerHTML = `${name}<input type="range" min="${s.min}" max="${s.max}" step="${s.step}"><output></output>`;
      } else if (s.type === 'select') {
        row.innerHTML = `${name}<select>${s.options.map((o) => `<option>${o}</option>`).join('')}</select>`;
      } else if (s.type === 'check') {
        row.innerHTML = `${name}<input type="checkbox">`;
      } else {
        row.innerHTML = `${name}<input type="number">`;
      }
      const el = row.querySelector('input, select');
      el.addEventListener('input', () => onControl(s, el, row));
      inputs[s.k] = { el, row, s };
      body.appendChild(row);
    }
    syncControls();
  }

  function buildFeatures(body) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="featbtns"><button class="small" data-f="all">all</button><button class="small" data-f="none">none</button>
      <button class="small" data-f="noprobe">no lookahead</button></div><div class="feats"></div>
      <div class="hint">Orange = lookahead probes: simulate 30 ticks per action (costly but powerful). ⟲ needs reset.</div>`;
    const grid = wrap.querySelector('.feats');
    OBS_NAMES.forEach((n, i) => {
      const l = document.createElement('label');
      if (i >= C.OBS_BASE) l.className = 'probe';
      l.innerHTML = `<input type="checkbox" data-i="${i}"> ${n}`;
      l.querySelector('input').addEventListener('input', (e) => { cfg.features[i] = e.target.checked; afterChange(true); });
      grid.appendChild(l);
    });
    wrap.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const f = b.dataset.f;
      cfg.features = cfg.features.map((_, i) => f === 'all' || (f === 'noprobe' && i < C.OBS_BASE));
      syncControls(); afterChange(true);
    }));
    body.appendChild(wrap);
    inputs.features = { grid };
  }

  function syncControls() {
    for (const k in inputs) {
      if (k === 'features') {
        inputs.features.grid.querySelectorAll('input').forEach((el) => { el.checked = !!cfg.features[+el.dataset.i]; });
        continue;
      }
      const { el, row, s } = inputs[k];
      if (s.type === 'check') el.checked = !!cfg[k];
      else el.value = cfg[k];
      if (s.type === 'range') row.querySelector('output').textContent = fmtVal(cfg[k], s);
    }
    $('#liveToggle').checked = cfg.liveOn;
    applyLiveVisibility();
  }
  function fmtVal(v, s) { return s.step < 0.01 ? (+v).toFixed(3) : s.step < 1 ? (+v).toFixed(2) : String(v); }

  function onControl(s, el, row) {
    let v;
    if (s.type === 'check') v = el.checked;
    else if (s.type === 'range' || s.type === 'number') v = parseFloat(el.value);
    else v = el.value;
    if (s.type === 'number' && !Number.isFinite(v)) return;
    cfg[s.k] = v;
    if (s.type === 'range') row.querySelector('output').textContent = fmtVal(v, s);
    if (s.k === 'sigmaMin' && cfg.sigmaMin > cfg.sigmaMax) { cfg.sigmaMax = cfg.sigmaMin; syncControls(); }
    if (s.k === 'sigmaMax' && cfg.sigmaMax < cfg.sigmaMin) { cfg.sigmaMin = cfg.sigmaMax; syncControls(); }
    if (['chartWindow', 'smooth'].includes(s.k)) chartsDirty = true;
    if (['ghosts', 'source'].includes(s.k)) live.restartIn = 1;
    if (s.k === 'maxTicks' && S) { S.cap = cfg.maxTicks; updateTiles(); }
    afterChange(!!s.reset);
  }

  function afterChange(isReset) {
    persistCfg();
    if (isReset) updateBanner();
  }

  function updateBanner() {
    $('#banner').hidden = !S || archKeyOf(cfg) === S.archKey;
  }

  // ---------- worker pool ----------
  class Pool {
    constructor() { this.ws = []; }
    resize(n) {
      while (this.ws.length > n) this.ws.pop().terminate();
      while (this.ws.length < n) this.ws.push(new Worker('worker.js'));
    }
    // Dynamically feeds tasks to idle workers (episodes vary a lot in length).
    run(tasks, make) {
      return new Promise((resolve, reject) => {
        const results = [];
        let next = 0, done = 0;
        if (!tasks.length) { resolve(results); return; }
        const feed = (w) => {
          if (next >= tasks.length) return;
          const t = tasks[next++], { msg, transfer } = make(t);
          w.onmessage = (e) => { results.push(e.data); if (++done === tasks.length) resolve(results); else feed(w); };
          w.onerror = (e) => { e.preventDefault(); reject(new Error(e.message || 'worker error')); };
          w.postMessage(msg, transfer);
        };
        this.ws.forEach(feed);
      });
    }
  }
  const pool = new Pool();

  // ---------- training state ----------
  let S = null;

  function newRun(seed) {
    const netCfg = netCfgOf(cfg), net = NN.makeNet(netCfg);
    S = {
      netCfg, net, archKey: archKeyOf(cfg), netKey: JSON.stringify(netCfg),
      evo: new Evolver(net, evoCfgOf(cfg), seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : seed),
      history: [], top: null, bestEver: null, lastScores: null,
      totals: { episodes: 0, steps: 0, elapsedMs: 0 }, genTimes: [], forkedFrom: null, cap: cfg.maxTicks,
    };
    live.restartIn = 1;
    updateBanner(); chartsDirty = true; drawHeatmap(); updateTiles();
  }

  function snapshot() {
    return { v: 1, savedAt: Date.now(), cfg: JSON.parse(JSON.stringify(cfg)), netCfg: S.netCfg, archKey: S.archKey,
      evo: S.evo.serialize(), history: S.history, top: S.top, bestEver: S.bestEver, lastScores: S.lastScores,
      totals: S.totals, forkedFrom: S.forkedFrom, cap: S.cap };
  }

  // fork: keep the population/architecture from `snap` but current dials, and start a fresh history.
  function restore(snap, fork, forkName) {
    if (!fork) Object.assign(cfg, snap.cfg);
    else for (const k of RESET_KEYS) cfg[k] = Array.isArray(snap.cfg[k]) ? snap.cfg[k].slice() : snap.cfg[k];
    if (!Array.isArray(cfg.features) || cfg.features.length !== C.OBS_SIZE) cfg.features = DEFAULTS().features;
    const net = NN.makeNet(snap.netCfg);
    const evo = Evolver.restore(net, evoCfgOf(cfg), snap.evo);
    cfg.popSize = evo.P;
    S = {
      netCfg: snap.netCfg, net, archKey: archKeyOf(cfg), netKey: JSON.stringify(snap.netCfg), evo,
      history: fork ? [] : snap.history || [], top: snap.top, bestEver: fork ? null : snap.bestEver,
      lastScores: snap.lastScores, totals: fork ? { episodes: 0, steps: 0, elapsedMs: 0 } : snap.totals,
      genTimes: [], forkedFrom: fork ? forkName : snap.forkedFrom,
      cap: fork || !snap.cap ? cfg.maxTicks : snap.cap,
    };
    if (fork) { evo.gen = 0; evo.bestEverFit = -Infinity; evo.sinceImprove = 0; }
    persistCfg(); syncControls(); updateBanner();
    live.restartIn = 1; chartsDirty = true; drawHeatmap(); updateTiles();
  }

  // ---------- generation ----------
  // Evaluate genomes `ids` (population indices) with the given tick budget across the worker pool.
  // Returns stats rows in `ids` order. Seeds are keyed by population index, so a re-run replays the same levels.
  async function evalSubset(ids, budget, ev, gen) {
    const { evo } = S, n = evo.n, workers = Math.max(1, cfg.workers | 0);
    pool.resize(workers);
    const chunk = Math.max(1, Math.ceil(ids.length / (workers * 4)));
    const tasks = [];
    for (let s = 0; s < ids.length; s += chunk) tasks.push({ start: s, count: Math.min(chunk, ids.length - s) });
    const evB = Object.assign({}, ev, { maxTicks: budget });
    const results = await pool.run(tasks, (t) => {
      const buf = new Float32Array(t.count * n), idArr = new Int32Array(t.count);
      for (let i = 0; i < t.count; i++) {
        const id = ids[t.start + i];
        idArr[i] = id;
        buf.set(evo.pop.subarray(id * n, id * n + n), i * n);
      }
      return { msg: { type: 'eval', gen, start: t.start, count: t.count, buf: buf.buffer, ids: idArr.buffer, ev: evB,
        netCfg: S.netCfg, netKey: S.netKey }, transfer: [buf.buffer, idArr.buffer] };
    });
    const rows = new Float32Array(ids.length * NN.STATS);
    let steps = 0;
    for (const r of results) { rows.set(new Float32Array(r.out), r.start * NN.STATS); steps += r.steps; }
    return { rows, steps };
  }

  async function runGeneration() {
    const tStart = performance.now();
    const { evo } = S, P = evo.P, n = evo.n, gen = evo.gen, STATS = NN.STATS, I = NN.S;
    evo.cfg = evoCfgOf(cfg);
    const ev = evalCfgOf(cfg);
    if (!cfg.capAdaptive) S.cap = cfg.maxTicks;
    const cap = Math.max(1, Math.round(S.cap));

    // Racing: everyone gets the first budget; after each stage only the top `raceKeep` fraction that were
    // still alive at the budget get re-run with a bigger one. Genomes that died early already have exact results.
    const budgets = cfg.raceOn ? NN.raceBudgets(cfg.raceBase, cfg.raceGrow, cap) : [cap];
    const stats = new Float32Array(P * STATS), fit = new Float32Array(P).fill(-Infinity);
    let active = Array.from({ length: P }, (_, i) => i), steps = 0, eps = 0, finalIds = null, finalBudget = 0;
    const stageSizes = [];
    for (let si = 0; si < budgets.length; si++) {
      stageSizes.push(active.length);
      const { rows, steps: st } = await evalSubset(active, budgets[si], ev, gen);
      if (S.evo !== evo) return; // run was replaced while evaluating
      steps += st; eps += active.length * ev.episodes;
      active.forEach((id, k) => {
        stats.set(rows.subarray(k * STATS, k * STATS + STATS), id * STATS);
        // Longer budgets replay the same episodes further, so fitness is kept monotone per genome.
        fit[id] = Math.max(fit[id], rows[k * STATS + I.FIT]);
      });
      finalIds = active; finalBudget = budgets[si];
      if (si === budgets.length - 1) break;
      const keepN = Math.max(Math.ceil(active.length * cfg.raceKeep), Math.min(active.length, cfg.elites | 0));
      const next = active.slice().sort((x, y) => fit[y] - fit[x]).slice(0, keepN).filter((id) => stats[id * STATS + I.CAPPED] > 0);
      if (!next.length) break;
      active = next;
    }
    const evalMs = performance.now() - tStart;

    // Adaptive cap: if too many of the best genomes' episodes run into the full cap, raise it.
    let capHit = 0;
    if (finalBudget === cap) {
      let c = 0;
      for (const id of finalIds) c += stats[id * STATS + I.CAPPED];
      capHit = c / (finalIds.length * ev.episodes);
    }
    const capBefore = cap;
    if (cfg.capAdaptive && capHit >= cfg.capHitFrac && S.cap < cfg.capMax) {
      S.cap = Math.min(cfg.capMax, Math.round(S.cap * cfg.capGrow));
      toast(`Episode cap raised to ${fmt(S.cap)} ticks (${Math.round(capHit * 100)}% of final-stage episodes were capped)`);
    }

    const scores = new Float32Array(P);
    let maxEp = 0, sumFit = 0, sumScore = 0, sumTicks = 0, sumTaps = 0, capped = 0;
    const deaths = [0, 0, 0, 0];
    for (let i = 0; i < P; i++) {
      const r = i * STATS;
      scores[i] = stats[r + I.SCORE];
      maxEp = Math.max(maxEp, stats[r + I.MAXSCORE]);
      sumFit += fit[i]; sumScore += scores[i]; sumTicks += stats[r + I.TICKS]; sumTaps += stats[r + I.TAPS];
      for (let c = 0; c < 4; c++) deaths[c] += stats[r + I.D_TIMEOUT + c];
      capped += stats[r + I.CAPPED];
    }
    const popEps = P * ev.episodes;
    const sorted = Array.from(scores).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(P - 1, Math.floor(p * P))];
    const order = Array.from({ length: P }, (_, i) => i).sort((a, b) => fit[b] - fit[a]);

    // Keep the top genomes for the live view before the population is replaced.
    const K = Math.min(TOP_K, P), top = new Float32Array(K * n);
    for (let i = 0; i < K; i++) top.set(evo.pop.subarray(order[i] * n, order[i] * n + n), i * n);
    S.top = { genomes: top, K, n, gen, fit: fit[order[0]], score: scores[order[0]], netKey: S.netKey };
    let bi = 0;
    for (let i = 1; i < P; i++) if (scores[i] > scores[bi]) bi = i;
    if (!S.bestEver || scores[bi] > S.bestEver.score) {
      S.bestEver = { genome: evo.pop.slice(bi * n, bi * n + n), score: scores[bi], gen, netKey: S.netKey, maxEp };
    }

    const sigma = evo.meanSigma(), div = evo.diversity();
    const { boosted } = evo.step(fit);
    const genMs = performance.now() - tStart;
    const rec = {
      gen, maxEp, bestMean: scores[order[0]], topMean: sorted[P - 1], p90: q(0.9), median: q(0.5), mean: sumScore / P,
      bestFit: fit[order[0]], meanFit: sumFit / P, sigma, div,
      dStall: (deaths[0] - capped) / popEps, dCap: capped / popEps, dBar: deaths[1] / popEps, dSquare: deaths[2] / popEps, dFell: deaths[3] / popEps,
      cap: capBefore, capHit, stages: stageSizes, budgets: budgets.slice(0, stageSizes.length),
      tps: steps / (evalMs / 1000), genMs, evalMs, steps, meanTicks: sumTicks / P, meanTaps: sumTaps / P,
      bestEver: S.bestEver.score, boosted, stagn: evo.sinceImprove,
    };
    S.history.push(rec);
    if (S.history.length > 5000) { // thin older half
      const h = S.history, cut = h.length - 1000;
      S.history = h.slice(0, cut).filter((_, i) => i % 2 === 0).concat(h.slice(cut));
    }
    S.lastScores = scores;
    S.totals.episodes += eps; S.totals.steps += steps; S.totals.elapsedMs += genMs;
    S.genTimes.push(performance.now()); if (S.genTimes.length > 20) S.genTimes.shift();
    if (boosted) toast(`Stagnation: σ boosted ×${cfg.boost}, ${Math.floor(P * cfg.immigrants)} immigrants`);
    if (cfg.autosave && evo.gen % Math.max(1, cfg.autosaveEvery | 0) === 0) autosave();
    chartsDirty = true; heatDirty = true;
    updateTiles();
  }

  let running = false, looping = false, stepOnly = false;
  async function loop() {
    if (looping) return;
    looping = true; updateRunUI();
    try {
      while (running && S) {
        await runGeneration();
        if (stepOnly) { running = false; stepOnly = false; }
        await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
      }
    } catch (e) {
      console.error(e); toast('Training error: ' + e.message); running = false;
    }
    looping = false; updateRunUI();
  }
  function setRunning(on) { running = on; stepOnly = false; if (on) loop(); updateRunUI(); }
  function updateRunUI() {
    $('#btnRun').textContent = running ? 'Pause' : 'Start';
    $('#btnRun').classList.toggle('primary', !running);
    const st = $('#runState');
    st.textContent = running ? 'training' : looping ? 'finishing gen…' : 'paused';
    st.className = 'state ' + (running ? 'running' : 'idle');
  }

  // ---------- caching ----------
  let storeOK = true, saving = false;
  async function autosave() {
    if (!storeOK || !S || saving) return;
    saving = true;
    try {
      await Store.put('autosave', snapshot());
      $('#saveState').textContent = `autosaved gen ${S.evo.gen} · ${new Date().toLocaleTimeString()}`;
    } catch (e) { $('#saveState').textContent = 'autosave failed: ' + e.message; }
    saving = false;
  }

  async function refreshCheckpoints() {
    const list = $('#ckList');
    if (!storeOK) { list.innerHTML = '<div class="hint">Storage unavailable in this browser context.</div>'; return; }
    let rows = [];
    try { rows = await Store.listCheckpoints(); } catch (e) { list.textContent = 'Could not list checkpoints.'; return; }
    list.innerHTML = rows.length ? '' : '<div class="hint">No checkpoints yet.</div>';
    for (const m of rows) {
      const d = document.createElement('div');
      d.className = 'ck';
      d.innerHTML = `<div class="nm"></div><div class="meta">gen ${m.gen} · best ${fmt(m.bestScore)} · pop ${m.popSize} · ${m.arch}<br>${new Date(m.createdAt).toLocaleString()}</div>
        <div class="acts"><button class="small" data-a="load" title="Restore exactly (settings, history, population)">Load</button>
        <button class="small" data-a="fork" title="Continue from this population with your current dials, fresh history">Fork</button>
        <button class="small" data-a="rename">Rename</button><button class="small" data-a="del">Delete</button></div>`;
      d.querySelector('.nm').textContent = m.name;
      d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => ckAction(b, m, d)));
      list.appendChild(d);
    }
  }

  async function ckAction(btn, m, row) {
    const a = btn.dataset.a;
    if (a === 'del') { confirmClick(btn, 'Sure?', async () => { await Store.deleteCheckpoint(m.id); refreshCheckpoints(); }); return; }
    if (a === 'rename') {
      const nm = row.querySelector('.nm'), inp = document.createElement('input');
      inp.type = 'text'; inp.value = m.name; nm.replaceWith(inp); inp.focus(); inp.select();
      const commit = async () => { await Store.renameCheckpoint(m.id, inp.value.trim() || m.name); refreshCheckpoints(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') refreshCheckpoints(); });
      inp.addEventListener('blur', commit, { once: true });
      return;
    }
    setRunning(false);
    const data = await Store.loadCheckpoint(m.id);
    if (!data) { toast('Checkpoint data missing'); return; }
    restore(data, a === 'fork', m.name);
    toast(a === 'fork' ? `Forked from “${m.name}” — press Start` : `Loaded “${m.name}” (gen ${m.gen})`);
  }

  async function saveCheckpoint() {
    if (!S) return;
    const nameIn = $('#ckName');
    const best = S.bestEver ? S.bestEver.score : 0;
    const meta = { name: nameIn.value.trim() || `gen ${S.evo.gen} · best ${fmt(best)}`, createdAt: Date.now(),
      gen: S.evo.gen, bestScore: best, popSize: S.evo.P,
      arch: `${S.net.sizes.join('→')} ${S.netCfg.activation}` };
    try { await Store.saveCheckpoint(meta, snapshot()); nameIn.value = ''; toast('Checkpoint saved'); refreshCheckpoints(); }
    catch (e) { toast('Save failed: ' + e.message); }
  }

  // ---------- tiles ----------
  const TILES = [
    ['gen', 'Generation', () => S.evo.gen],
    ['bestEver', 'Best-ever genome (mean score)', () => (S.bestEver ? fmt(S.bestEver.score) : '—'), true],
    ['maxEp', 'Best single episode', () => fmt(Math.max(0, ...S.history.map((h) => h.maxEp)))],
    ['genBest', 'Gen champion score', () => (last() ? fmt(last().bestMean) : '—')],
    ['genMean', 'Gen mean score', () => (last() ? fmt(last().mean) : '—')],
    ['episodes', 'Episodes played', () => fmt(S.totals.episodes)],
    ['steps', 'Game ticks simulated', () => fmt(S.totals.steps)],
    ['tps', 'Ticks / sec', () => (last() ? fmt(last().tps) : '—')],
    ['gpm', 'Gens / min', () => gensPerMin()],
    ['elapsed', 'Training time', () => fmtTime(S.totals.elapsedMs)],
    ['sigma', 'Mean σ', () => S.evo.meanSigma().toFixed(3)],
    ['stagn', 'Gens since improve', () => S.evo.sinceImprove],
    ['cap', 'Episode cap (ticks)', () => fmt(S.cap)],
    ['race', 'Race stages (genomes)', () => (last() && last().stages ? last().stages.join('→') : '—')],
    ['pop', 'Population', () => S.evo.P],
    ['params', 'Params / genome', () => `${S.evo.n} (${S.net.sizes.join('→')})`],
  ];
  const last = () => S && S.history[S.history.length - 1];
  function gensPerMin() {
    const t = S.genTimes;
    return t.length < 2 ? '—' : ((t.length - 1) / ((t[t.length - 1] - t[0]) / 60000)).toFixed(1);
  }
  function buildTiles() {
    $('#tiles').innerHTML = TILES.map(([id, k, , hl]) => `<div class="tile${hl ? ' hl' : ''}"><div class="k" title="${k}">${k}</div><div class="v" id="t_${id}">—</div></div>`).join('');
  }
  function updateTiles() {
    if (!S) return;
    for (const [id, , get] of TILES) $('#t_' + id).textContent = get();
  }

  // ---------- charts ----------
  let chartsDirty = true, heatDirty = true, lastChartDraw = 0;
  const COL = { best: '#4ea1ff', bestMean: '#b07cff', p90: '#2fbf9b', median: '#f0b429', mean: '#ff7a59', ever: '#9aa3b2' };
  function drawCharts() {
    const h = S.history, o = { window: cfg.chartWindow === 'all' ? 0 : +cfg.chartWindow, smooth: +cfg.smooth };
    Charts.line($('#chScore'), h, { ...o, yMin: 0, series: [
      { label: 'best episode', color: COL.best, get: (r) => r.maxEp, width: 1 },
      { label: 'best genome (mean)', color: COL.bestMean, get: (r) => r.topMean, width: 2 },
      { label: 'p90', color: COL.p90, get: (r) => r.p90 },
      { label: 'median', color: COL.median, get: (r) => r.median },
      { label: 'mean', color: COL.mean, get: (r) => r.mean },
      { label: 'best ever', color: COL.ever, get: (r) => r.bestEver, dash: [4, 4], width: 1 }] });
    Charts.line($('#chFit'), h, { ...o, series: [
      { label: 'best', color: COL.best, get: (r) => r.bestFit }, { label: 'mean', color: COL.mean, get: (r) => r.meanFit }] });
    Charts.line($('#chAdapt'), h, { ...o, yMin: 0, series: [
      { label: 'mean σ', color: COL.p90, get: (r) => r.sigma }, { label: 'diversity', color: COL.bestMean, get: (r) => r.div }] });
    Charts.stacked($('#chDeath'), h, { ...o, series: [
      { label: 'square', color: '#b07cff', get: (r) => r.dSquare }, { label: 'bar', color: '#4ea1ff', get: (r) => r.dBar },
      { label: 'fell', color: '#ff7a59', get: (r) => r.dFell }, { label: 'stalled', color: '#8a8f98', get: (r) => r.dStall },
      { label: 'hit cap', color: '#2fbf9b', get: (r) => r.dCap || 0 }] });
    Charts.line($('#chCap'), h, { ...o, yMin: 0, series: [
      { label: 'cap (k ticks)', color: COL.best, get: (r) => (r.cap || 0) / 1000, width: 2 },
      { label: 'final-stage capped %', color: COL.median, get: (r) => (r.capHit || 0) * 100 },
      { label: 'genomes reaching last stage %', color: COL.p90, get: (r) => (r.stages ? (r.stages[r.stages.length - 1] / r.stages[0]) * 100 : 100) }] });
    Charts.line($('#chEp'), h, { ...o, yMin: 0, series: [
      { label: 'mean ticks / episode', color: COL.best, get: (r) => r.meanTicks }, { label: 'mean taps / episode', color: COL.median, get: (r) => r.meanTaps }] });
    Charts.line($('#chTput'), h, { ...o, yMin: 0, series: [
      { label: 'ticks / sec', color: COL.p90, get: (r) => r.tps }, { label: 'gen ms ×1000', color: COL.mean, get: (r) => r.genMs * 1000 }] });
    Charts.hist($('#chHist'), S.lastScores, { color: COL.bestMean, label: 'genome mean score (count)' });
  }
  function drawHeatmap() {
    heatDirty = false;
    if (!S || !S.top || S.top.netKey !== S.netKey) { Charts.heatmap($('#chHeat'), null); return; }
    Charts.heatmap($('#chHeat'), S.net, S.top.genomes, 0);
  }

  // ---------- live view ----------
  const renderer = new Renderer($('#liveCanvas'));
  const live = { games: [], lastProg: [], lastScore: [], genomes: null, net: null, netKey: '', K: 0, n: 0, steps: 0, acc: 0,
    restartIn: 1, seed: 0, obs: new Float32Array(C.OBS_SIZE), champObs: new Float32Array(C.OBS_SIZE), action: 0,
    acts: null, scratch: new Game(0), probes: [[], [], []], probeAlive: [true, true, true], srcLabel: '', finished: 0 };

  function liveStart() {
    const src = cfg.source === 'best ever' && S.bestEver ? 'ever' : 'top';
    if (!S || !S.top) return false;
    let genomes, K, n = S.top.n, netKey;
    if (src === 'ever') {
      genomes = S.bestEver.genome; K = 1; netKey = S.bestEver.netKey;
      live.srcLabel = `best ever · gen ${S.bestEver.gen}`;
    } else {
      K = Math.min(S.top.K, (cfg.ghosts | 0) + 1); genomes = S.top.genomes.slice(0, K * n); netKey = S.top.netKey;
      live.srcLabel = `gen ${S.top.gen} top ${K}`;
    }
    if (netKey !== live.netKey) { live.net = NN.makeNet(JSON.parse(netKey)); live.netKey = netKey; }
    if (live.net.nParams !== n) return false;
    live.genomes = genomes; live.K = K; live.n = n;
    live.seed = (Math.random() * 2 ** 32) >>> 0;
    while (live.games.length < K) live.games.push(new Game(0));
    live.games.length = K;
    for (const g of live.games) g.reset(live.seed);
    live.lastProg = new Array(K).fill(0); live.lastScore = new Array(K).fill(0);
    live.steps = 0; live.acc = 0; live.finished = 0;
    live.acts = live.net.acts.map((a) => new Float32Array(a.length));
    return true;
  }

  function liveStep() {
    const ev = evalCfgOf(cfg), k = Math.max(1, ev.decisionInterval | 0), stall = ev.stallTicks > 0 ? ev.stallTicks : Infinity;
    const net = live.net, decide = live.steps % k === 0;
    let alive = 0;
    for (let i = live.K - 1; i >= 0; i--) { // champion (0) last so its activations remain in net.acts
      const g = live.games[i];
      if (!g.alive) continue;
      let a = 0;
      if (decide) {
        g.observe(live.obs, net.scratch);
        a = NN.forward(net, live.genomes, i * live.n, live.obs);
        if (i === 0) { live.champObs.set(live.obs); live.action = a; net.acts.forEach((x, l) => live.acts[l].set(x)); }
      }
      g.step(a);
      if (g.score !== live.lastScore[i]) { live.lastScore[i] = g.score; live.lastProg[i] = live.steps; }
      if (g.alive && (live.steps - live.lastProg[i] > stall || live.steps >= S.cap)) { g.alive = false; g.deathCause = 0; }
      if (g.alive) alive++;
    }
    live.steps++;
    return alive;
  }

  function computeProbes(champ) {
    const sc = live.scratch;
    for (let a = 0; a < 3; a++) {
      const pts = live.probes[a];
      pts.length = 0;
      sc.copyFrom(champ);
      pts.push(sc.x, sc.y);
      let ok = sc.step(a);
      pts.push(sc.x, sc.y);
      for (let t = 1; t < C.PROBE_H && ok; t++) { ok = sc.step(0); pts.push(sc.x, sc.y); }
      live.probeAlive[a] = sc.alive;
    }
  }

  let netFrame = 0;
  function liveFrame() {
    if (!S || !S.top) { $('#liveInfo').textContent = 'Press Start — the live view begins after the first generation.'; return; }
    if (live.restartIn > 0 && --live.restartIn === 0) { if (!liveStart()) { live.restartIn = 30; return; } }
    if (!live.genomes) return;
    let alive = live.games.reduce((s, g) => s + (g.alive ? 1 : 0), 0);
    if (alive > 0) {
      if (cfg.speed === 'max') {
        const t0 = performance.now();
        while (alive > 0 && performance.now() - t0 < 10) alive = liveStep();
      } else {
        live.acc += +cfg.speed;
        while (live.acc >= 1 && alive > 0) { live.acc -= 1; alive = liveStep(); }
      }
      if (alive === 0) live.restartIn = 60;
    }
    const champ = live.games[0];
    let leader = champ;
    for (const g of live.games) if (g.alive && (!leader.alive || g.score > leader.score || (g.score === leader.score && g.y < leader.y))) leader = g;
    const cam = cfg.follow === 'champion' && champ.alive ? champ : leader;
    const showProbes = cfg.probes && champ.alive && champ.started;
    if (showProbes) computeProbes(champ);
    renderer.drawScene(cam, live.games, champ, {
      sensors: cfg.sensors && champ.started ? live.champObs : null,
      probes: showProbes ? live.probes : null, probeAlive: live.probeAlive,
      label: live.srcLabel,
    });
    const best = live.games.reduce((m, g) => Math.max(m, g.score), 0);
    $('#liveInfo').innerHTML = `tick ${live.steps} · alive ${alive}/${live.K} · champion <b>${champ.score}</b>${champ.alive ? '' : ' (' + ['stalled', 'hit bar', 'hit square', 'fell'][champ.deathCause] + ')'} · best ghost ${best}<br>` +
      `<span style="color:#f0962a">— goal vector</span> · <span style="color:#c828a0">— nearest squares</span> · arcs: lookahead of idle (dashed) / left / right — <span style="color:#28aa5a">safe</span> / <span style="color:#dc3c3c">deadly</span>`;
    if (cfg.netPanel && (netFrame++ % 3 === 0)) {
      const labels = live.net.inputs.map((i) => OBS_NAMES[i]);
      const saved = live.net.acts;
      live.net.acts = live.acts;
      Charts.network($('#netCanvas'), live.net, live.genomes, 0, labels, live.action);
      live.net.acts = saved;
    }
  }

  function applyLiveVisibility() {
    $('#liveOff').hidden = cfg.liveOn;
    $('#liveCanvas').style.visibility = cfg.liveOn ? 'visible' : 'hidden';
  }

  // ---------- main animation loop (UI only; training runs in workers) ----------
  function frame(now) {
    if (cfg.liveOn) liveFrame();
    if (S && chartsDirty && now - lastChartDraw > 250) { chartsDirty = false; lastChartDraw = now; drawCharts(); }
    if (S && heatDirty) drawHeatmap();
    requestAnimationFrame(frame);
  }

  // ---------- wiring ----------
  function wire() {
    $('#btnRun').addEventListener('click', () => setRunning(!running));
    $('#btnStep').addEventListener('click', () => { if (!running && !looping) { running = true; stepOnly = true; loop(); } });
    $('#btnReset').addEventListener('click', (e) => confirmClick(e.currentTarget, 'Confirm reset', () => {
      setRunning(false); newRun(); toast('New random population');
    }));
    $('#btnApplyArch').addEventListener('click', () => { setRunning(false); newRun(); toast('Population reset with new architecture'); });
    $('#btnRevertArch').addEventListener('click', () => {
      const [netCfg, popSize] = JSON.parse(S.archKey);
      Object.assign(cfg, { features: netCfg.features, hidden1: netCfg.hidden[0], hidden2: netCfg.hidden[1], activation: netCfg.activation, popSize });
      persistCfg(); syncControls(); updateBanner();
    });
    $('#liveToggle').addEventListener('input', (e) => { cfg.liveOn = e.target.checked; persistCfg(); applyLiveVisibility(); if (cfg.liveOn) live.restartIn = 1; });
    $('#btnCkSave').addEventListener('click', saveCheckpoint);
    $('#ckName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCheckpoint(); });
    $('#btnClearAuto').addEventListener('click', (e) => confirmClick(e.currentTarget, 'Confirm clear', async () => {
      try { await Store.del('autosave'); toast('Autosave cleared'); $('#saveState').textContent = ''; } catch (err) { toast('Failed: ' + err.message); }
    }));
    document.addEventListener('visibilitychange', () => { if (document.hidden && cfg.pauseHidden && running) { setRunning(false); toast('Paused (tab hidden)'); } });
    window.addEventListener('pagehide', () => { if (cfg.autosave && S && S.evo.gen > 0) autosave(); });
    const ro = new ResizeObserver(() => { renderer.resize(); chartsDirty = true; heatDirty = true; });
    ro.observe($('#liveBox'));
    window.addEventListener('resize', () => { chartsDirty = true; heatDirty = true; });
  }

  async function init() {
    buildControls(); buildTiles(); wire(); updateRunUI();
    storeOK = await Store.available();
    $('#storeNote').textContent = storeOK ? 'saved in this browser (IndexedDB)' : 'storage unavailable — nothing will persist';
    let snap = null;
    if (storeOK) { try { snap = await Store.get('autosave'); } catch (e) { snap = null; } }
    if (snap && snap.evo) {
      try { restore(snap, false); toast(`Resumed from autosave · gen ${snap.evo.gen} — press Start to continue`); }
      catch (e) { console.error(e); newRun(); }
    } else newRun();
    refreshCheckpoints();
    requestAnimationFrame(frame);
  }
  init();
})();
