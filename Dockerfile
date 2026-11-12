# One image: builds the web portal and serves it from the Node server, so the
# portal, API, webhooks and media links share one origin.
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM node:22-bookworm-slim
# Fonts used when charts are rendered to images for WhatsApp and Teams
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-ibm-plex \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SERVE_WEB_DIR=/app/public
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server ./server
COPY --from=web /app/web/dist ./public
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
