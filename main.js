// Browser driver: fixed 60 Hz simulation, input queue, high score.
(function () {
  'use strict';
  const { Game } = window.Engine;
  const TICK_MS = 1000 / 60;
  const BEST_KEY = 'diamond-climb-best';

  const canvas = document.getElementById('game');
  const renderer = new window.Renderer(canvas);
  const game = new Game();
  const queue = []; // pending actions, one consumed per tick
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) {}
  let diedAt = 0;

  function saveBest() {
    if (game.score <= best) return;
    best = game.score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
  }

  function restart() {
    game.reset();
    queue.length = 0;
  }

  function input(action) {
    if (!game.alive) {
      if (performance.now() - diedAt > 350) restart();
      return;
    }
    if (queue.length < 3) queue.push(action);
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') { input(1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { input(2); e.preventDefault(); }
    else if ((e.key === ' ' || e.key === 'Enter') && !game.alive) { input(0); e.preventDefault(); }
  });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    input(e.clientX - r.left < r.width / 2 ? 1 : 2);
  });
  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now(), acc = 0;
  function frame(now) {
    acc = Math.min(acc + now - last, 250);
    last = now;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      if (!game.alive) break;
      game.step(queue.length ? queue.shift() : 0);
      if (!game.alive) { diedAt = now; saveBest(); }
    }
    saveBest();
    renderer.draw(game, best);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
