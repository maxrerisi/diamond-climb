// Headless evaluation worker: plays episodes for a slice of the population and returns per-genome stats.
importScripts('engine.js', 'nn.js');

let net = null, netKey = '';
const game = new Engine.Game(0);

onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'eval') return;
  if (m.netKey !== netKey) { net = NN.makeNet(m.netCfg); netKey = m.netKey; }
  const genomes = new Float32Array(m.buf);
  const out = new Float32Array(m.count * NN.STATS);
  const ids = m.ids ? new Int32Array(m.ids) : null;
  const seedFor = NN.seedFn(m.ev.seedMode, m.ev.seedBase, m.gen, ids ? (i) => ids[i] : m.start);
  const t0 = performance.now();
  const steps = NN.evaluate(net, genomes, m.count, m.ev, seedFor, out, game);
  postMessage({ id: m.id, start: m.start, count: m.count, out: out.buffer, steps, ms: performance.now() - t0 }, [out.buffer]);
};
