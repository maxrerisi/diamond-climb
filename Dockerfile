# Static site: the game and trainer are plain HTML/JS (no build step), served by nginx on port 8347.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html train.html train.css \
     engine.js render.js main.js nn.js evo.js worker.js store.js charts.js train.js \
     /usr/share/nginx/html/

EXPOSE 8347
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8347/healthz || exit 1
