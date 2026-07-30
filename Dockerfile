# Minimotor samples showcase — the landing page, every demo game, the generated
# API reference, and the live WebSocket endpoints the networking samples need
# (/ws-echo, /ws-relay, /ws-signal, /ws-road-rivals).
#
#   docker compose up --build      # → http://localhost:8765/
#
# Three stages: a full build image, then TWO runtime images:
#   web  — plain nginx serving samples-dist/ + reverse-proxying the WS paths
#   ws   — a node sidecar running ONLY the WebSocket endpoints (server-dist/)
# nginx owns the static bytes; only live sockets cross into node.

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11

COPY package.json ./
# --ignore-scripts: skip the `prepare` (tsc) lifecycle — src/ isn't here yet and
# we build explicitly below.
RUN pnpm install --no-frozen-lockfile --ignore-scripts

COPY . .
# build        → tsc, engine to build/ (samples + the server bundle alias to it)
# docs:api     → API reference from build/*.d.ts → samples/api/
# samples:build→ vite build, landing + every sample → samples-dist/
# server:build → tsc the WS sidecar (+ its graph) → server-dist/ (plain ESM)
# then fold the generated API reference into the served output.
RUN pnpm run build \
  && pnpm run docs:api \
  && pnpm run samples:build \
  && pnpm run server:build \
  && cp -r samples/api samples-dist/api

# ---------- web (nginx: static + reverse proxy) ----------
FROM nginx:alpine AS web
RUN apk add --no-cache curl
COPY --from=build /app/samples-dist /usr/share/nginx/html
COPY tools/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
# Fail if nginx stops answering the landing page (not just if it's alive).
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -fsS http://127.0.0.1/ >/dev/null || exit 1

# ---------- ws (node sidecar: WebSocket endpoints only) ----------
FROM node:22-alpine AS ws
WORKDIR /app
RUN apk add --no-cache curl && npm install -g pnpm@11
# package.json is needed at runtime too: it marks the dir "type": "module" so
# node runs the ESM in server-dist/. `ws` is the only runtime dependency (planck
# is an OPTIONAL PEER dep now, so it never lands in this image). --ignore-scripts skips
# the `prepare` (tsc) lifecycle, which has no source to compile in this stage.
# tsc output (server-dist/) is plain ESM; static files are served by nginx.
COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile --ignore-scripts
COPY --from=build /app/server-dist ./server-dist
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -fsS http://127.0.0.1:8765/healthz >/dev/null || exit 1
CMD ["node", "server-dist/tools/serve.js"]
