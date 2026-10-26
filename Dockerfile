# trixie (glibc 2.41): the slicers' Ubuntu 24.04 builds don't run on bookworm (ADR-0013).
FROM node:22-trixie-slim AS base
# Compilers are only a fallback for better-sqlite3 when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @3d-maker-suite/web build
# APP_INSTALL: the app shows `docker compose pull` instead of an Update button (ADR-0009).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4300 APP_DATA_DIR=/data APP_INSTALL=docker
VOLUME /data
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["pnpm", "--filter", "@3d-maker-suite/server", "start"]

# `-slicer` image: the libraries Bambu Studio and OrcaSlicer need, so a server slicer can be installed from the app.
FROM base AS slicer
RUN apt-get update && apt-get install -y --no-install-recommends   libgtk-3-0t64 libwebkit2gtk-4.1-0 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0   libgl1 libegl1 libglu1-mesa libsm6 libice6 libopengl0 libmspack0t64   && rm -rf /var/lib/apt/lists/*

# Last stage = the default (small) image.
FROM base
