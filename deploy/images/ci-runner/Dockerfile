# db3 CI runner: a GitHub Actions runner on node-browser, so a job has Node, Playwright's
# Chromium and its system libraries without installing anything. db3 Cloud runs it as one-job
# pods on servers ticked "GitHub Actions", each with its own MariaDB beside it on 127.0.0.1.
# Published as ghcr.io/db3ai/ci-runner:24-playwright-<version> by .github/workflows/base-images.yml.
ARG PLAYWRIGHT_VERSION
FROM ghcr.io/db3ai/node-browser:24-playwright-${PLAYWRIGHT_VERSION}
ARG RUNNER_VERSION
ARG TARGETARCH
USER root
RUN test -n "$RUNNER_VERSION" \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git jq libicu72 libkrb5-3 liblttng-ust1 zlib1g unzip xz-utils zstd \
	&& mkdir /runner && cd /runner \
	&& arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64) \
	&& curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${arch}-${RUNNER_VERSION}.tar.gz" | tar xz \
	&& chown -R node:node /runner \
	&& rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /runner
# Cloud hands each pod a just-in-time config: the runner takes one job, then exits.
ENTRYPOINT ["/bin/sh", "-c", "exec ./run.sh --jitconfig \"$RUNNER_JIT_CONFIG\""]
