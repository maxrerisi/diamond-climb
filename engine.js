// Pure, DOM-free physics engine. Deterministic given (seed, action sequence).
// Units: screen width = 400, one tick = 1/60 s, world y grows downward.
(function (root) {
  'use strict';

  const C = {
    W: 400,
    H: 713,
    GRAVITY: 0.323,     // per tick^2
    TAP_VY: -9.05,      // vy is SET on tap
    TAP_VX: 1.46,       // vx is SET to +/- on tap, no drag
    WALL_SLIDE: 3.91,   // constant downward slide while stuck to a side wall
    R: 15,              // diamond half-diagonal
    BAR_H: 42,
    GAP_W: 139,
    GAP_MIN: 40,
    GAP_MAX: 220,
    LEVEL_DY: 407,      // vertical distance between consecutive bars
    SQ: 28,             // small square side
    SQ_DY_MIN: 62,      // square centre distance from the nearby bar's edge (measured 62..114)
    SQ_DY_MAX: 114,
    SQ_DX_BELOW: 90,    // square under a gap: centre within +/- this of the gap centre
    SQ_DX_ABOVE: 65,    // square over a gap
    CAM_FRAC: 0.5,      // camera keeps diamond at or below this fraction of screen height
    FIRST_BAR_TOP: -32, // first bar pokes into the top of the screen at start
    SLOTS: 4,           // ring buffer size (levels alive at once)
    OBS_SIZE: 26,
    OBS_BASE: 20,       // features 20..25 are lookahead probes (costly; only computed on request)
    PROBE_H: 30,        // probe horizon in ticks (about one tap arc)
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // L1 distance from point to box <= r  <=>  diamond overlaps box.
  function diamondHitsBox(cx, cy, r, x0, y0, x1, y1) {
    const dx = cx < x0 ? x0 - cx : (cx > x1 ? cx - x1 : 0);
    const dy = cy < y0 ? y0 - cy : (cy > y1 ? cy - y1 : 0);
    return dx + dy < r;
  }

  class Game {
    constructor(seed) {
      const n = C.SLOTS;
      // Level k lives in slot k % SLOTS. Squares of level k sit below bar k (between bar k and bar k-1).
      this.lvl = new Int32Array(n);     // level index stored in slot (-1 = empty)
      this.barY = new Float64Array(n);  // bar top (world y)
      this.gapX = new Float64Array(n);  // gap left edge
      this.sqX = new Float64Array(n * 2); // square centers
      this.sqY = new Float64Array(n * 2);
      this.hasSq = new Uint8Array(n);
      this.passed = new Uint8Array(n);
      this.reset(seed);
    }

    reset(seed) {
      this.seed = seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : seed >>> 0;
      this.rng = mulberry32(this.seed);
      this.x = C.W / 2;
      this.y = C.H / 2;
      this.vx = 0;
      this.vy = 0;
      this.camY = 0;
      this.score = 0;
      this.tick = 0;
      this.alive = true;
      this.started = false;
      this.onWall = 0; // -1 left, +1 right, 0 none
      this.deathCause = 0; // 0 alive, 1 bar, 2 square, 3 fell off bottom
      this.lvl.fill(-1);
      this.passed.fill(0);
      this.nextLevel = 0;
      this._spawn();
      return this;
    }

    _genLevel(k) {
      const s = k % C.SLOTS, rng = this.rng;
      this.lvl[s] = k;
      this.barY[s] = C.FIRST_BAR_TOP - k * C.LEVEL_DY;
      this.gapX[s] = C.GAP_MIN + rng() * (C.GAP_MAX - C.GAP_MIN);
      this.passed[s] = 0;
      if (k === 0) { this.hasSq[s] = 0; return; } // spawn area is clear
      this.hasSq[s] = 1;
      const lo = C.SQ / 2, hi = C.W - C.SQ / 2;
      const clampX = (x) => (x < lo ? lo : (x > hi ? hi : x));
      const dy = () => C.SQ_DY_MIN + rng() * (C.SQ_DY_MAX - C.SQ_DY_MIN);
      const ps = (k - 1) % C.SLOTS;
      // Square under this bar's gap (the approach), then square over the previous bar's gap (the exit).
      this.sqX[s * 2] = clampX(this.gapX[s] + C.GAP_W / 2 + (rng() * 2 - 1) * C.SQ_DX_BELOW);
      this.sqY[s * 2] = this.barY[s] + C.BAR_H + dy();
      this.sqX[s * 2 + 1] = clampX(this.gapX[ps] + C.GAP_W / 2 + (rng() * 2 - 1) * C.SQ_DX_ABOVE);
      this.sqY[s * 2 + 1] = this.barY[ps] - dy();
    }

    // Keep levels generated until one bar sits above the top of the screen.
    _spawn() {
      while (C.FIRST_BAR_TOP - (this.nextLevel - 1) * C.LEVEL_DY > this.camY - C.LEVEL_DY) {
        this._genLevel(this.nextLevel++);
      }
    }

    // action: 0 = nothing, 1 = left tap, 2 = right tap. Returns alive.
    step(action) {
      if (!this.alive) return false;
      if (action === 1 || action === 2) {
        this.started = true;
        this.vy = C.TAP_VY;
        this.vx = action === 1 ? -C.TAP_VX : C.TAP_VX;
        this.onWall = 0;
      }
      if (!this.started) return true;
      this.tick++;

      if (this.onWall) this.vy = C.WALL_SLIDE;
      else this.vy += C.GRAVITY;
      this.x += this.vx;
      this.y += this.vy;

      // Sticky side walls: kill horizontal + upward motion, slide down at constant speed.
      const R = C.R;
      if (this.x <= R) { this.x = R; this.vx = 0; this.vy = C.WALL_SLIDE; this.onWall = -1; }
      else if (this.x >= C.W - R) { this.x = C.W - R; this.vx = 0; this.vy = C.WALL_SLIDE; this.onWall = 1; }

      // Camera only moves up.
      const camTarget = this.y - C.H * C.CAM_FRAC;
      if (camTarget < this.camY) { this.camY = camTarget; this._spawn(); }

      // Fell off the bottom of the screen.
      if (this.y - R > this.camY + C.H) { this.alive = false; this.deathCause = 3; return false; }

      const x = this.x, y = this.y, half = C.SQ / 2;
      for (let s = 0; s < C.SLOTS; s++) {
        if (this.lvl[s] < 0) continue;
        const by = this.barY[s], gx = this.gapX[s];
        if (diamondHitsBox(x, y, R, 0, by, gx, by + C.BAR_H) ||
            diamondHitsBox(x, y, R, gx + C.GAP_W, by, C.W, by + C.BAR_H)) { this.alive = false; this.deathCause = 1; return false; }
        if (this.hasSq[s]) {
          for (let j = s * 2; j < s * 2 + 2; j++) {
            const qx = this.sqX[j], qy = this.sqY[j];
            if (diamondHitsBox(x, y, R, qx - half, qy - half, qx + half, qy + half)) { this.alive = false; this.deathCause = 2; return false; }
          }
        }
        if (!this.passed[s] && y < by) { this.passed[s] = 1; this.score++; }
      }
      return true;
    }

    // Copy full state from another game (no allocation). Its RNG is not copied: levels spawned
    // later in a scratch copy may differ, which is fine for short lookahead.
    copyFrom(g) {
      this.x = g.x; this.y = g.y; this.vx = g.vx; this.vy = g.vy; this.camY = g.camY;
      this.score = g.score; this.tick = g.tick; this.alive = g.alive; this.started = g.started;
      this.onWall = g.onWall; this.deathCause = g.deathCause; this.nextLevel = g.nextLevel;
      this.lvl.set(g.lvl); this.barY.set(g.barY); this.gapX.set(g.gapX); this.sqX.set(g.sqX);
      this.sqY.set(g.sqY); this.hasSq.set(g.hasSq); this.passed.set(g.passed);
      return this;
    }

    // Lookahead: for actions none/left/right, simulate PROBE_H ticks (the action, then idle) on `scratch`.
    // Writes survival fraction (0..1) to out[o..o+2] and goal closeness at the end to out[o+3..o+5].
    probe(out, o, scratch) {
      const H = C.PROBE_H, k0 = this.score;
      for (let a = 0; a < 3; a++) {
        scratch.copyFrom(this);
        let t = 0;
        if (scratch.step(a)) for (t = 1; t < H && scratch.step(0); t++);
        out[o + a] = scratch.alive ? 1 : t / H;
        if (!scratch.alive) { out[o + 3 + a] = 0; continue; }
        const s = scratch.score % C.SLOTS;
        const dx = scratch.gapX[s] + C.GAP_W / 2 - scratch.x, dy = scratch.barY[s] + C.BAR_H / 2 - scratch.y;
        const d = Math.sqrt(dx * dx + dy * dy) / C.LEVEL_DY;
        out[o + 3 + a] = (scratch.score - k0) + (d < 1 ? 1 - d : 0);
      }
    }

    // Normalized feature vector for agents (length C.OBS_SIZE); see OBS_NAMES.
    // Probe features (20..25) are only filled when `scratch` (a spare Game) is given.
    observe(out, scratch) {
      const W = C.W, x = this.x, y = this.y;
      // Bars can only be passed in order, so the next bar's level index is the score.
      const k = this.score, s = k % C.SLOTS, s1 = (k + 1) % C.SLOTS;
      const gx = this.gapX[s], by = this.barY[s];
      const gdx = gx + C.GAP_W / 2 - x, gdy = by + C.BAR_H / 2 - y;
      out[0] = x / W;
      out[1] = this.vx / C.TAP_VX;
      out[2] = this.vy / -C.TAP_VY;
      out[3] = (y - this.camY) / C.H;
      out[4] = this.onWall;
      out[5] = gdx / W;
      out[6] = gdy / W;
      out[7] = Math.sqrt(gdx * gdx + gdy * gdy) / W;
      out[8] = (x - C.R - gx) / W;
      out[9] = (gx + C.GAP_W - x - C.R) / W;
      out[10] = (by + C.BAR_H - y) / W;
      out[11] = (this.barY[s1] - y) / W;
      out[12] = (this.gapX[s1] + C.GAP_W / 2 - x) / W;
      // The 3 nearest squares not already below the diamond (levels k and k+1), closest first.
      let o = 13, prevY = Infinity;
      const floor = y + C.SQ / 2 + C.R;
      for (let i = 0; i < 3; i++) {
        let bj = -1, bY = -Infinity;
        for (let q = 0; q < 4; q++) {
          const slot = q < 2 ? s : s1, j = slot * 2 + (q & 1);
          if (!this.hasSq[slot]) continue;
          const qy = this.sqY[j];
          if (qy < floor && qy < prevY && qy > bY) { bY = qy; bj = j; }
        }
        if (bj >= 0) { out[o++] = (this.sqX[bj] - x) / W; out[o++] = (bY - y) / W; prevY = bY; }
        else { out[o++] = 0; out[o++] = -2; prevY = -Infinity; } // none: park far above
      }
      out[19] = this.vy > 0 ? 1 : 0;
      if (scratch && this.started) this.probe(out, 20, scratch);
      else for (let i = 20; i < 26; i++) out[i] = i < 23 ? 1 : 0;
      return out;
    }
  }

  const OBS_NAMES = ['x', 'vx', 'vy', 'screen y', 'on wall', 'goal dx', 'goal dy', 'goal dist',
    'gap left clr', 'gap right clr', 'bar bottom dy', 'next bar dy', 'next gap dx',
    'sq1 dx', 'sq1 dy', 'sq2 dx', 'sq2 dy', 'sq3 dx', 'sq3 dy', 'falling',
    'probe survive: idle', 'probe survive: left', 'probe survive: right',
    'probe goal: idle', 'probe goal: left', 'probe goal: right'];

  const api = { C, Game, mulberry32, diamondHitsBox, OBS_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
