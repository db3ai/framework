# db3 base image: Node with Playwright's Chromium and the system libraries it needs, for ARM
# and Intel. Apps that drive a browser start FROM it, so a deploy only compiles and copies the
# app: no apt or Chromium download per build, and no emulation when a builder of one CPU type
# builds for another. Published as ghcr.io/db3ai/node-browser:<node>-playwright-<version> by
# .github/workflows/base-images.yml; an app picks the tag matching its own playwright version.
ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-bookworm-slim
ARG PLAYWRIGHT_VERSION
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN test -n "$PLAYWRIGHT_VERSION" \
	&& npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
	&& chmod -R a+rX /ms-playwright \
	&& rm -rf /root/.npm /var/lib/apt/lists/*
USER node
WORKDIR /app
