# Diamond Climb

A replica of the tap-to-climb game from the screen recording. It has a DOM-free physics engine, a canvas player, and a neuroevolution trainer with a live analytics dashboard.

```
python3 -m http.server 8765        # then open http://localhost:8765 (play) or /train.html (trainer)
```
(The trainer uses Web Workers, so it has to be served over http, not opened as file://.)

## Files
- `engine.js`: deterministic physics (`new Game(seed)`, `step(0|1|2)`, `observe(out, scratch?)`, `copyFrom`, `deathCause`). Constants were measured from the 60 fps recording.
- `render.js`, `main.js`, `index.html`: the player (← / →).
- `nn.js`: MLP policy, headless episode runner, fitness. `evo.js`: GA with self-adaptive σ, elitism, tournament selection, crossover, and a stagnation boost with immigrants.
- `train.html`, `train.css`, `train.js`, `worker.js`, `charts.js`, `store.js`: the trainer dashboard.
- `bench.js` (`--check` for physics tests) and `evo-check.js` (headless learning + cache round-trip test).

## Agent inputs (toggle each one in the trainer)
- Position, velocity, camera-relative height, and wall contact.
- Goal vector and distance to the next gap centre.
- Clearance to both gap edges, the next bar's distance, and the bar-after-next's gap.
- Relative positions of the 3 nearest squares above the diamond.
- A "falling" flag.
- Six **lookahead probes**: survival and goal-closeness after simulating 30 ticks of idle / left / right. Without the probes, agents plateau around ~1.5 bars. With them, the best genomes average about 100.

Episode length is handled by **racing + an adaptive cap**. Everyone first plays a short budget (1k ticks). Only the best genomes still alive at that point are re-run with 2×, 4×, … budgets, up to the cap. The cap doubles whenever ≥20% of the final stage's episodes run into it. All of these are dials under *Cap & racing*.

Training state auto-saves to IndexedDB and resumes on reload. Named checkpoints can be loaded (an exact restore) or forked (the same population, your current dials, a fresh history).
