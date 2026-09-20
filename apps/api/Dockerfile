# apps/api/Dockerfile — با podman build و docker build هر دو سازگار است.
#
# چرا FROM با رجیستری کامل (docker.io/...)؟
#  • podman بدون ابهام پول می‌کند (بدون پرامپت short-name در محیط تعاملی)
#  • میرور تنظیم‌شده در registries.conf دقیقاً روی prefix «docker.io» اعمال
#    می‌شود — یعنی دانلود از آینه، بدون هیچ تغییری در این فایل.
#
# RUN --mount=type=cache توسط Buildah (podman build) پشتیبانی می‌شود؛
# بدترین حالت فقط کندتر شدن بیلد است، نه شکست آن.

FROM docker.io/oven/bun:1.3.14-slim AS base
WORKDIR /app
ENV TZ=Asia/Tehran \
    BUN_TELEMETRY_DISABLED=1

# Debian repositories use HTTP by default.
# In restricted networks, use HTTPS so apt does not need port 80.
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=sinshin-bun-api,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --network-concurrency 8

FROM deps AS dev
ENV NODE_ENV=development
COPY packages/shared/src packages/shared/src
COPY apps/api apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "run", "dev", "--host", "0.0.0.0"]

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=sinshin-bun-api-runtime,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --network-concurrency 8
COPY packages/shared/src packages/shared/src
COPY apps/api apps/api
RUN mkdir -p /data/uploads \
    && chown -R bun:bun /app /data/uploads
WORKDIR /app/apps/api
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]

FROM runtime AS migrate
CMD ["bun", "src/infra/db/migrate.ts"]