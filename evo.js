// Neuroevolution: elitism + tournament selection + uniform crossover + self-adaptive Gaussian mutation,
// with stagnation-triggered sigma boost and random immigrants. DOM-free; state is plain data (cacheable).
(function (root) {
  'use strict';
  const NN = root.NN || (typeof require !== 'undefined' ? require('./nn') : null);

  class Rng {
    constructor(s) { this.s = s >>> 0; this.spare = null; }
    next() {
      let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    randn() {
      if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      v = this.next();
      const m = Math.sqrt(-2 * Math.log(u));
      this.spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    }
  }

  class Evolver {
    // cfg: popSize, initSigma, sigmaMin, sigmaMax, tauScale, mutRate, elites, tournament, crossover,
    //      stagnation, boost, immigrants (fraction)
    constructor(net, cfg, seed) {
      this.net = net;
      this.cfg = cfg;
      this.rng = new Rng(seed);
      this.P = cfg.popSize;
      this.n = net.nParams;
      this.pop = new Float32Array(this.P * this.n);
      this.sigma = new Float32Array(this.P);
      this.gen = 0;
      this.bestEverFit = -Infinity;
      this.sinceImprove = 0;
      const rn = () => this.rng.randn();
      for (let i = 0; i < this.P; i++) { NN.initGenome(net, this.pop, i * this.n, rn); this.sigma[i] = cfg.initSigma; }
      this.next = new Float32Array(this.pop.length);
      this.nextSigma = new Float32Array(this.P);
    }

    _tournament(order, fit) {
      const T = Math.max(1, this.cfg.tournament | 0);
      let best = -1;
      for (let t = 0; t < T; t++) {
        const c = (this.rng.next() * this.P) | 0;
        if (best < 0 || fit[c] > fit[best]) best = c;
      }
      return best;
    }

    // Advance one generation given fitness of the current population. Returns {order, boosted}.
    step(fit) {
      const { P, n, pop, sigma, next, nextSigma, rng, cfg } = this;
      const order = Array.from({ length: P }, (_, i) => i).sort((a, b) => fit[b] - fit[a]);

      let boosted = false;
      if (fit[order[0]] > this.bestEverFit + 1e-9) { this.bestEverFit = fit[order[0]]; this.sinceImprove = 0; }
      else this.sinceImprove++;
      let boost = 1, immigrants = 0;
      if (cfg.stagnation > 0 && this.sinceImprove >= cfg.stagnation) {
        boost = cfg.boost; immigrants = Math.floor(P * cfg.immigrants); boosted = true; this.sinceImprove = 0;
      }

      const tau = cfg.tauScale / Math.sqrt(n);
      const E = Math.min(P, Math.max(0, cfg.elites | 0));
      for (let i = 0; i < E; i++) { // elites survive untouched
        next.set(pop.subarray(order[i] * n, order[i] * n + n), i * n);
        nextSigma[i] = sigma[order[i]];
      }
      const rn = () => rng.randn();
      for (let i = E; i < P; i++) {
        const off = i * n;
        if (i >= P - immigrants) { NN.initGenome(this.net, next, off, rn); nextSigma[i] = cfg.initSigma; continue; }
        const a = this._tournament(order, fit);
        let s;
        if (rng.next() < cfg.crossover) {
          const b = this._tournament(order, fit), ao = a * n, bo = b * n;
          for (let j = 0; j < n; j++) next[off + j] = rng.next() < 0.5 ? pop[ao + j] : pop[bo + j];
          s = Math.sqrt(sigma[a] * sigma[b]);
        } else {
          next.set(pop.subarray(a * n, a * n + n), off);
          s = sigma[a];
        }
        s = s * boost * Math.exp(tau * rng.randn());
        s = Math.min(cfg.sigmaMax, Math.max(cfg.sigmaMin, s));
        nextSigma[i] = s;
        const p = cfg.mutRate;
        for (let j = 0; j < n; j++) if (p >= 1 || rng.next() < p) next[off + j] += s * rng.randn();
      }
      this.next = pop; this.pop = next;
      this.nextSigma = sigma; this.sigma = nextSigma;
      this.gen++;
      return { order, boosted };
    }

    // Mean L2 distance to centroid, normalized per sqrt(param).
    diversity() {
      const { P, n, pop } = this, c = new Float64Array(n);
      for (let i = 0; i < P; i++) for (let j = 0; j < n; j++) c[j] += pop[i * n + j] / P;
      let tot = 0;
      for (let i = 0; i < P; i++) {
        let d = 0;
        for (let j = 0; j < n; j++) { const v = pop[i * n + j] - c[j]; d += v * v; }
        tot += Math.sqrt(d / n);
      }
      return tot / P;
    }

    meanSigma() { let s = 0; for (let i = 0; i < this.P; i++) s += this.sigma[i]; return s / this.P; }

    serialize() {
      return { pop: this.pop.slice(), sigma: this.sigma.slice(), gen: this.gen, bestEverFit: this.bestEverFit,
        sinceImprove: this.sinceImprove, rng: this.rng.s, spare: this.rng.spare };
    }

    static restore(net, cfg, st) {
      const e = new Evolver(net, Object.assign({}, cfg, { popSize: st.sigma.length }), st.rng);
      e.pop.set(st.pop); e.sigma.set(st.sigma);
      e.rng.s = st.rng; e.rng.spare = st.spare === undefined ? null : st.spare;
      e.gen = st.gen; e.bestEverFit = st.bestEverFit; e.sinceImprove = st.sinceImprove;
      e.cfg = cfg;
      return e;
    }
  }

  const api = { Evolver, Rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Evo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
