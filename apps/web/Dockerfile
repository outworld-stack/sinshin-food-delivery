# ═══════════════════════════════════════════════════════════════
# round-49 — sinshin-food-delivery — فایل 3 از 6
# مسیر مقصد: apps/web/Dockerfile
# وضعیت: جایگزینی کامل فایل موجود
# کامیت پیشنهادی: stage forty-three
# ═══════════════════════════════════════════════════════════════

# apps/web/Dockerfile — برای Docker (BuildKit) نوشته شده.
#
# چرا FROM با نام کوتاه (بدون پیشوند docker.io)؟
#  • پیش‌فرض docker.io است و نام کوتاه خواناتر است.
#  • میرور تعریف‌شده در /etc/docker/daemon.json به‌صورت خودکار روی
#    pull از docker.io اعمال می‌شود — هم برای `docker pull` و هم برای
#    `docker build` با درایور پیش‌فرض (BuildKit داخل همان daemon).
#
# RUN --mount=type=cache در BuildKit داکر به‌صورت بومی پشتیبانی
# می‌شود — کش بیلد بین اجراها حفظ می‌شود و بیلدها سریع می‌مانند.

FROM oven/bun:1.3.14-slim AS base

WORKDIR /app

ENV TZ=Asia/Tehran \
    BUN_TELEMETRY_DISABLED=1


# ──────────────────────────────────────────────────────────
# Dependencies
# ──────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json bun.lock bunfig.toml ./

COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=sinshin-bun-web,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --network-concurrency 8


# ──────────────────────────────────────────────────────────
# Development
# ──────────────────────────────────────────────────────────
FROM deps AS dev

# round-49 — کلید نقشهٔ نشان: در دِو هم از همان build arg می‌آید
# (Vite متغیرهای VITE_* را از محیط build می‌خواند؛ خالی = فرم دستی).
ARG VITE_NESHAN_API_KEY
ENV VITE_NESHAN_API_KEY=${VITE_NESHAN_API_KEY}

ENV NODE_ENV=development

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["bun", "run", "dev", "--host", "0.0.0.0"]


# ──────────────────────────────────────────────────────────
# Production build
# ──────────────────────────────────────────────────────────
FROM deps AS build

# round-49 — کلید نقشهٔ نشان باید «موقع build» داخل باندل برود —
# Vite متغیرهای VITE_* را از محیط build جایگزین می‌کند. compose این
# مقدار را از ‎.env ریشه (VITE_NESHAN_API_KEY) به‌عنوان build arg
# می‌رساند؛ خالی = فرم مختصات دستی جای نقشه (رفتار قبلی).
ARG VITE_NESHAN_API_KEY
ENV VITE_NESHAN_API_KEY=${VITE_NESHAN_API_KEY}

COPY packages/shared/src packages/shared/src
COPY apps/web apps/web

WORKDIR /app/apps/web

RUN bun run build:pwa


# ──────────────────────────────────────────────────────────
# Production runtime
# ──────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production

COPY package.json bun.lock bunfig.toml ./

COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=sinshin-bun-web-runtime,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

COPY --from=build /app/apps/web/.output ./apps/web/.output

RUN chown -R bun:bun /app

WORKDIR /app/apps/web

USER bun

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]