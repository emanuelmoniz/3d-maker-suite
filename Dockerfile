# trixie (glibc 2.41): the slicers' Ubuntu 24.04 builds don't run on bookworm (ADR-0013).
FROM node:22-trixie-slim AS base
# Compilers are only a fallback for better-sqlite3 when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
# The guide (/guide/) is built from wiki/ after the web build, which empties its dist.
RUN pnpm install --frozen-lockfile && pnpm --filter @3d-maker-suite/web build && pnpm guide:build
# Links the package to this repository on ghcr.io.
LABEL org.opencontainers.image.source="https://github.com/emanuelmoniz/3d-maker-suite"       org.opencontainers.image.description="3D Maker Suite: manager for 3D printing (linux/amd64 and linux/arm64)"
# APP_INSTALL: the app shows `docker compose pull` instead of an Update button (ADR-0009).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4300 APP_DATA_DIR=/data APP_INSTALL=docker
VOLUME /data
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
# PUID and PGID pick the user the program and /data belong to (docker/entrypoint.sh, ADR-0024).
# Started with node, not pnpm: as another user, pnpm (corepack) downloads itself again and then fails on node_modules.
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
# From /app, where `docker compose exec app pnpm user:reset-password` finds its script.
CMD ["node", "--import", "./apps/server/node_modules/tsx/dist/loader.mjs", "apps/server/src/main.ts"]

# `-slicer` image: the libraries Bambu Studio and OrcaSlicer need, so a server slicer can be installed from the app.
# x64 only: Bambu Studio has no Linux ARM build, and an ARM server doesn't slice (ADR-0024).
FROM base AS slicer
LABEL org.opencontainers.image.description="3D Maker Suite with the libraries to slice on the server (linux/amd64 only: Bambu Studio has no Linux ARM build)"
RUN apt-get update && apt-get install -y --no-install-recommends   libgtk-3-0t64 libwebkit2gtk-4.1-0 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0   libgl1 libegl1 libglu1-mesa libsm6 libice6 libopengl0 libmspack0t64   && rm -rf /var/lib/apt/lists/*

# The connector (ADR-0014, ADR-0024): only the pruned tree its archive holds (packaging/build.mjs --image), not the source tree.
# `docker build --target connector .` makes it; it joins a hub that runs elsewhere and is never a hub itself.
FROM node:22-trixie-slim AS connector-build
RUN corepack enable
WORKDIR /src
COPY . .
RUN node packaging/build.mjs --product connector --image /connector

FROM node:22-trixie-slim AS connector
LABEL org.opencontainers.image.source="https://github.com/emanuelmoniz/3d-maker-suite"       org.opencontainers.image.description="3D Maker Suite Connector: joins a hub from a NAS or server (linux/amd64 and linux/arm64)"
COPY --from=connector-build /connector /app
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# APP_INSTALL: no self-update and no start at login; the hub shows `docker compose pull` when it is behind.
ENV NODE_ENV=production APP_DATA_DIR=/data APP_INSTALL=docker
VOLUME /data
# The status page listens on the container's own loopback only; it is there for this check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "let p=4301;try{p=require('/data/config.json').port||p}catch{};fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/apps/connector
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "src/main.ts"]

# Last stage = the default (small) image.
FROM base
