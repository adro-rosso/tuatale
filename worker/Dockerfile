# worker/Dockerfile — Tuatale pipeline worker image.
#
# IMPORTANT: build context is the REPO ROOT, not worker/. The worker imports the
# pipeline core from ../../src, so the image must contain both worker/ AND the
# repo-root src/ + templates/ + root node_modules. Build/deploy commands:
#
#   docker build -f worker/Dockerfile -t tuatale-worker:local .        # from repo root
#   fly deploy --config worker/fly.toml                                 # from repo root
#
# (Running `fly deploy` from inside worker/ would set the context to worker/ and
#  the COPY of root package.json / src/ would fail.)

FROM ghcr.io/puppeteer/puppeteer:latest

# Install + Chrome download run as root; final runtime user is pptruser (10042).
USER root
WORKDIR /app

# Chrome cache we control (both build + runtime read PUPPETEER_CACHE_DIR). We
# install the Chrome build that OUR puppeteer version pins (below), rather than
# rely on the base image's bundled Chrome matching our version.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# Chrome can't use its sandbox without the SYS_ADMIN capability, which Fly.io
# doesn't grant — so page-pipeline.js launches with these flags (env-gated).
ENV PUPPETEER_LAUNCH_ARGS="--no-sandbox --disable-setuid-sandbox"
ENV NODE_ENV=production
ENV PORT=8080

# ---- Dependencies (cache-friendly: manifests first) -----------------------
# Root deps = the pipeline's deps (pdf-lib, sharp, puppeteer, @google/genai,
# @anthropic-ai/sdk, ...). Worker deps = express, inngest, supabase, sentry.
COPY package.json package-lock.json ./
COPY worker/package.json worker/package-lock.json ./worker/

# --ignore-scripts skips puppeteer's auto Chromium download (we do it
# explicitly below) and any other postinstalls. sharp ships prebuilt linux
# binaries as optional deps, so it needs no build script.
RUN npm ci --omit=dev --ignore-scripts
RUN cd worker && npm ci --omit=dev --ignore-scripts

# Install the exact Chrome build our puppeteer pins, into PUPPETEER_CACHE_DIR.
RUN npx puppeteer browsers install chrome

# ---- Source ----------------------------------------------------------------
COPY src/ ./src/
COPY templates/ ./templates/
COPY worker/src/ ./worker/src/

# Sentry release tag (single project shared with the website; distinguished by
# release). Passed at build time: --build-arg SENTRY_RELEASE=$(git rev-parse --short HEAD)
ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

EXPOSE 8080

# Hand everything to the non-root puppeteer user for runtime.
RUN chown -R 10042:10042 /app
USER 10042

CMD ["node", "worker/src/server.js"]
