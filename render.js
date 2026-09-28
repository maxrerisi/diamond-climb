// Canvas renderer. Reads engine state only; never mutates it.
(function (root) {
  'use strict';
  const { C } = root.Engine;
  const PALETTE = ['#82b4fa', '#8a4bab', '#f0a93b', '#3fb28c', '#e8615a'];
  const LEVELS_PER_COLOR = 4;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();
    }

    // Fits the window, or the canvas's parent element when canvas.dataset.fit === 'parent'.
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const box = this.canvas.dataset.fit === 'parent' ? this.canvas.parentElement : null;
      const bw = box ? box.clientWidth : window.innerWidth, bh = box ? box.clientHeight : window.innerHeight;
      const scale = Math.max(0.05, Math.min(bw / C.W, bh / C.H));
      const cssW = Math.floor(C.W * scale), cssH = Math.floor(C.H * scale);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
      this.k = scale * dpr;
    }

    // Background + obstacles of game `g`, leaving the context translated into world space.
    _world(g) {
      const ctx = this.ctx, k = this.k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, C.W, C.H);
      ctx.translate(0, -g.camY);
      for (let s = 0; s < C.SLOTS; s++) {
        const lvl = g.lvl[s];
        if (lvl < 0) continue;
        ctx.fillStyle = PALETTE[Math.floor(lvl / LEVELS_PER_COLOR) % PALETTE.length];
        const by = g.barY[s], gx = g.gapX[s];
        ctx.fillRect(0, by, gx, C.BAR_H);
        ctx.fillRect(gx + C.GAP_W, by, C.W - gx - C.GAP_W, C.BAR_H);
        if (g.hasSq[s]) {
          for (let j = s * 2; j < s * 2 + 2; j++) {
            ctx.fillRect(g.sqX[j] - C.SQ / 2, g.sqY[j] - C.SQ / 2, C.SQ, C.SQ);
          }
        }
      }
    }

    _diamond(x, y, color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - C.R);
      ctx.lineTo(x + C.R, y);
      ctx.lineTo(x, y + C.R);
      ctx.lineTo(x - C.R, y);
      ctx.closePath();
      ctx.fill();
    }

    // Training view: world of `cam`, every live ghost game as a translucent diamond, `champ` solid.
    // opts: { sensors: obs Float32Array | null, probes: [[x,y,...], x3] | null, probeAlive: [bool x3], label }
    drawScene(cam, ghosts, champ, opts) {
      const ctx = this.ctx, k = this.k;
      this._world(cam);
      for (const g of ghosts) if (g.alive && g !== champ) this._diamond(g.x, g.y, 'rgba(90, 90, 110, 0.28)');
      if (champ && opts.probes) {
        ctx.lineWidth = 2;
        for (let a = 0; a < 3; a++) {
          const pts = opts.probes[a];
          if (pts.length < 4) continue;
          ctx.strokeStyle = opts.probeAlive[a] ? 'rgba(40, 170, 90, 0.8)' : 'rgba(220, 60, 60, 0.8)';
          ctx.setLineDash(a === 0 ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (champ && opts.sensors && champ.alive) {
        const o = opts.sensors, W = C.W;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(240, 150, 30, 0.9)';
        ctx.beginPath(); ctx.moveTo(champ.x, champ.y); ctx.lineTo(champ.x + o[5] * W, champ.y + o[6] * W); ctx.stroke();
        ctx.strokeStyle = 'rgba(200, 40, 160, 0.7)';
        for (let i = 0; i < 3; i++) {
          const dy = o[14 + i * 2];
          if (dy <= -1.99) continue;
          ctx.beginPath(); ctx.moveTo(champ.x, champ.y); ctx.lineTo(champ.x + o[13 + i * 2] * W, champ.y + dy * W); ctx.stroke();
        }
      }
      if (champ) this._diamond(champ.x, champ.y, champ.alive ? '#000' : 'rgba(200, 0, 0, 0.6)');
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#222';
      ctx.font = '300 34px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(String(cam.score), C.W - 14, 10);
      if (opts.label) {
        ctx.font = '400 13px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#777';
        ctx.fillText(opts.label, 12, 16);
      }
    }

    draw(g, best) {
      const ctx = this.ctx, k = this.k;
      this._world(g);
      this._diamond(g.x, g.y, '#000');

      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#222';
      ctx.font = '300 34px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(String(g.score), C.W - 14, 10);
      ctx.font = '300 14px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#888';
      ctx.fillText('BEST ' + best, 12, 16);

      if (!g.started) this._panel(['← / → to jump', 'tap left or right half on touch']);
      else if (!g.alive) this._panel(['GAME OVER', 'score ' + g.score + '   best ' + best, 'space / enter / tap to restart']);
    }

    _panel(lines) {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const y0 = C.H * 0.3;
      lines.forEach((t, i) => {
        ctx.fillStyle = i === 0 ? '#111' : '#666';
        ctx.font = (i === 0 ? '200 40px' : '300 16px') + ' "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.fillText(t, C.W / 2, y0 + (i === 0 ? 0 : 30 + i * 24));
      });
    }
  }

  root.Renderer = Renderer;
})(globalThis);
