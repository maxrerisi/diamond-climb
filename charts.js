// Tiny dependency-free canvas charts: line, stacked area, histogram, network diagram, weight heatmap.
(function (root) {
  'use strict';

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Size the backing store to the element's CSS box; returns {ctx, w, h} in CSS pixels.
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, canvas.clientWidth), h = Math.max(10, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    if (a >= 10 || v === 0) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(a >= 0.1 ? 2 : 3);
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(v);
    return out;
  }

  // Frame: axes, gridlines, labels. Returns mapping helpers.
  function frame(ctx, w, h, x0, x1, y0, y1, opts) {
    const L = 38, R = 8, T = opts.legend ? 20 : 8, B = 18;
    const pw = w - L - R, ph = h - T - B;
    const X = (x) => L + (x1 === x0 ? pw / 2 : ((x - x0) / (x1 - x0)) * pw);
    const Y = (y) => T + ph - (y1 === y0 ? ph / 2 : ((y - y0) / (y1 - y0)) * ph);
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--muted');
    ctx.lineWidth = 1;
    for (const v of niceTicks(y0, y1, Math.max(2, Math.floor(ph / 32)))) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 5, y);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (const v of niceTicks(x0, x1, Math.max(2, Math.floor(pw / 70)))) {
      if (v !== Math.round(v)) continue;
      ctx.fillText(fmt(v), X(v), T + ph + 4);
    }
    return { X, Y, L, T, pw, ph };
  }

  function legend(ctx, series, L) {
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = L;
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(x, 6, 10, 3);
      ctx.fillStyle = css('--muted');
      ctx.fillText(s.label, x + 14, 8);
      x += 20 + ctx.measureText(s.label).width;
    }
  }

  function windowed(rows, win) { return win && rows.length > win ? rows.slice(rows.length - win) : rows; }

  function ema(vals, a) {
    if (!a) return vals;
    const out = new Array(vals.length);
    let m = vals[0];
    for (let i = 0; i < vals.length; i++) { m = i === 0 ? vals[0] : a * m + (1 - a) * vals[i]; out[i] = m; }
    return out;
  }

  // rows: array of records with .gen; series: [{get(row), label, color, dash?, width?}]
  function line(canvas, rows, opts) {
    const { ctx, w, h } = setup(canvas);
    rows = windowed(rows, opts.window);
    if (!rows.length) { empty(ctx, w, h); return; }
    const xs = rows.map((r) => r.gen);
    const ys = opts.series.map((s) => ema(rows.map(s.get), opts.smooth));
    let lo = opts.yMin !== undefined ? opts.yMin : Infinity, hi = -Infinity;
    for (const arr of ys) for (const v of arr) { if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(hi)) hi = 1;
    if (!Number.isFinite(lo)) lo = 0;
    if (hi - lo < 1e-9) hi = lo + 1;
    hi += (hi - lo) * 0.05;
    const f = frame(ctx, w, h, xs[0], xs[xs.length - 1], lo, hi, { legend: true });
    opts.series.forEach((s, si) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || 1.5;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < xs.length; i++) {
        const v = ys[si][i];
        if (!Number.isFinite(v)) continue;
        if (!started) { ctx.moveTo(f.X(xs[i]), f.Y(v)); started = true; } else ctx.lineTo(f.X(xs[i]), f.Y(v));
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
    legend(ctx, opts.series, f.L);
  }

  // Stacked area of fractions (0..1).
  function stacked(canvas, rows, opts) {
    const { ctx, w, h } = setup(canvas);
    rows = windowed(rows, opts.window);
    if (!rows.length) { empty(ctx, w, h); return; }
    const xs = rows.map((r) => r.gen);
    const f = frame(ctx, w, h, xs[0], xs[xs.length - 1], 0, 1, { legend: true });
    const base = new Array(rows.length).fill(0);
    for (const s of opts.series) {
      const vals = ema(rows.map(s.get), opts.smooth);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) ctx.lineTo(f.X(xs[i]), f.Y(base[i] + vals[i]));
      for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(f.X(xs[i]), f.Y(base[i]));
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < xs.length; i++) base[i] += vals[i];
    }
    legend(ctx, opts.series, f.L);
  }

  function hist(canvas, values, opts) {
    const { ctx, w, h } = setup(canvas);
    if (!values || !values.length) { empty(ctx, w, h); return; }
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const bins = opts.bins || 24;
    if (hi - lo < 1e-9) hi = lo + 1;
    const counts = new Array(bins).fill(0);
    for (const v of values) counts[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
    const maxC = Math.max(...counts);
    const f = frame(ctx, w, h, lo, hi, 0, maxC, { legend: true });
    const bw = f.pw / bins;
    ctx.fillStyle = opts.color;
    counts.forEach((c, i) => {
      const y = f.Y(c);
      ctx.fillRect(f.L + i * bw + 1, y, Math.max(1, bw - 2), f.T + f.ph - y);
    });
    legend(ctx, [{ label: opts.label, color: opts.color }], f.L);
  }

  function empty(ctx, w, h) {
    ctx.fillStyle = css('--muted');
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('waiting for data…', w / 2, h / 2);
  }

  function signColor(v, alpha) {
    const a = Math.min(1, Math.abs(v)) * alpha;
    return v >= 0 ? `rgba(70, 150, 255, ${a})` : `rgba(255, 90, 80, ${a})`;
  }

  // Network diagram: neurons coloured by current activation (net.acts), edges by weight.
  function network(canvas, net, g, off, labels, action) {
    const { ctx, w, h } = setup(canvas);
    if (!net || !g) { empty(ctx, w, h); return; }
    const sizes = net.sizes, Lc = sizes.length;
    const padL = 92, padR = 46, padY = 10;
    const colX = (l) => padL + (l / (Lc - 1)) * (w - padL - padR);
    const rowY = (l, i) => padY + ((i + 0.5) / sizes[l]) * (h - 2 * padY);
    net.layers.forEach((layer, l) => {
      const { nIn, nOut } = layer;
      if (nIn * nOut > 4000) return;
      for (let o = 0; o < nOut; o++) for (let i = 0; i < nIn; i++) {
        const wt = g[off + layer.w + o * nIn + i];
        if (Math.abs(wt) < 0.15) continue;
        ctx.strokeStyle = signColor(wt, 0.35);
        ctx.lineWidth = Math.min(2.5, Math.abs(wt));
        ctx.beginPath(); ctx.moveTo(colX(l), rowY(l, i)); ctx.lineTo(colX(l + 1), rowY(l + 1, o)); ctx.stroke();
      }
    });
    const r = Math.max(2, Math.min(6, (h - 2 * padY) / Math.max(...sizes) / 2.4));
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let l = 0; l < Lc; l++) {
      const a = net.acts[l];
      for (let i = 0; i < sizes[l]; i++) {
        const x = colX(l), y = rowY(l, i);
        ctx.fillStyle = css('--panel');
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = signColor(a[i], 1);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = l === Lc - 1 && i === action ? css('--accent') : css('--grid');
        ctx.lineWidth = l === Lc - 1 && i === action ? 2 : 1;
        ctx.stroke();
        if (l === 0 && labels) {
          ctx.fillStyle = css('--muted'); ctx.textAlign = 'right';
          ctx.fillText(labels[i], x - r - 3, y);
        }
        if (l === Lc - 1) {
          ctx.fillStyle = i === action ? css('--text') : css('--muted'); ctx.textAlign = 'left';
          ctx.fillText(['idle', 'left', 'right'][i], x + r + 4, y);
        }
      }
    }
  }

  // Weight heatmap: each layer's matrix side by side (rows = outputs, cols = inputs).
  function heatmap(canvas, net, g, off) {
    const { ctx, w, h } = setup(canvas);
    if (!net || !g) { empty(ctx, w, h); return; }
    const gap = 10, totalCols = net.layers.reduce((s, l) => s + l.nIn + 1, 0);
    const cw = (w - gap * (net.layers.length - 1)) / totalCols;
    let x = 0;
    for (const layer of net.layers) {
      const { nIn, nOut } = layer, ch = h / nOut;
      for (let o = 0; o < nOut; o++) {
        for (let i = 0; i < nIn; i++) {
          ctx.fillStyle = signColor(g[off + layer.w + o * nIn + i], 1);
          ctx.fillRect(x + i * cw, o * ch, Math.ceil(cw), Math.ceil(ch));
        }
        ctx.fillStyle = signColor(g[off + layer.b + o], 1);
        ctx.fillRect(x + nIn * cw, o * ch, Math.ceil(cw), Math.ceil(ch));
      }
      x += (nIn + 1) * cw + gap;
    }
  }

  root.Charts = { line, stacked, hist, network, heatmap, fmt };
})(globalThis);
