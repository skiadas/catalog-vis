# Build stage: install the full toolchain (dev deps included) and produce the
# three built apps. Vite compiles the SCSS (style/*.scss) and bundles each app
# into dist/<name>/.
FROM node:26-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages packages
COPY apps apps
COPY server server
COPY style style
COPY vite.apps.mjs ./
RUN npm ci && npm run build

# Prod-deps stage: the runtime install (npm ci --omit=dev) so build-only
# tooling — vite, sass, typescript, eslint, playwright, vue … — never enters
# the runtime image. Measured: ~17 MB vs the ~130 MB full tree. `packages/` is
# copied because npm workspaces symlink into it during install.
FROM node:26-slim AS deps
WORKDIR /srv
COPY package.json package-lock.json ./
COPY packages packages
COPY server server
RUN npm ci --omit=dev

# Runtime stage: the Express server is the single process that serves the
# built apps, the catalog API, and the backend API from an assembled layout
# (/srv/static):
#   index.html + config.json          — the root launcher + service config
#   majors.json + the other artifacts — the catalog (also via the /catalog API)
#   apps/<name>/                      — the built apps, from dist/<name>/
# The apps' relative seams (loadCatalog's baseUrl '../../', the schedule API
# base '../../api') resolve to that root, so the layout mirrors the repo-root
# deployment shape. `packages/` is copied so the workspace symlinks in
# node_modules (e.g. @major-vis/schedule-core, imported by the server at
# boot) resolve — without it the server crashes with MODULE_NOT_FOUND.
FROM node:26-slim
ENV NODE_ENV=production \
    STATIC_DIR=/srv/static \
    DB_PATH=/data/major-vis.db \
    SERVICES=schedule \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /srv
COPY --from=deps /srv/node_modules node_modules
COPY packages packages
COPY server server
COPY index.html config.json majors.json requirements_parsed.json core_requirements.json /srv/static/
COPY --from=build /src/dist/browse /srv/static/apps/browse
COPY --from=build /src/dist/schedule /srv/static/apps/schedule
COPY --from=build /src/dist/planner /srv/static/apps/planner
# Persistent schedules/suggestions DB (see DB_PATH above).
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 8080}/api/config`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/src/index.js"]