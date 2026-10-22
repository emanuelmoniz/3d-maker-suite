FROM node:22-bookworm-slim
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
