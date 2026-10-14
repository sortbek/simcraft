# Keep this version in step with backend/rust-toolchain.toml; FROM cannot read it.
FROM rust:1.96-bookworm AS builder

WORKDIR /build

# Copy workspace files. Without Cargo.lock cargo resolves every dependency from
# scratch, so the shipped binary's graph can drift from the one CI tested.
# `--locked` makes that guarantee enforceable: the build fails if the lockfile
# drifts from the manifests, which scripts/sync-version.sh now keeps in sync.
COPY Cargo.toml Cargo.lock ./
COPY core/ core/
COPY server/ server/
COPY calibration/ calibration/
COPY migrations/ migrations/

ARG CARGO_FEATURES=
RUN cargo build --release --locked -p simhammer-server ${CARGO_FEATURES:+--features $CARGO_FEATURES}

# --- Fetch game data from Raidbots and compact ---
FROM node:20-slim AS fetcher

RUN apt-get update && apt-get install -y --no-install-recommends curl jq ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /data/full
RUN curl -sL -o metadata.json https://www.raidbots.com/static/data/live/metadata.json \
    && for f in $(jq -r '.files[]' metadata.json); do \
         echo "Downloading $f"; \
         curl -sL -o "$f" "https://www.raidbots.com/static/data/live/$f"; \
       done

COPY scripts/compact-data.js /compact-data.js
COPY core/season-config.json /data/full/season-config.json
# Not a Raidbots file: generated offline by fetch_icon_file_ids.py and committed,
# so it has to come from the build context or the deployed backend serves an
# empty map and every new-season icon 403s.
COPY resources/data/icon-file-ids.json /data/full/icon-file-ids.json
RUN node /compact-data.js /data/full /data/compact

# --- SimC: download pre-built OR build from source ---
FROM debian:bookworm-slim AS simc

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl jq git g++ make libcurl4-openssl-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ARG SIMC_SOURCE=prebuilt
ARG SIMC_GIT_REF=HEAD
ARG SIMC_ENABLED_BRANCHES=weekly
RUN set -e; \
    if [ "${SIMC_SOURCE}" = "build" ]; then \
      echo "=== Building SimC from source (${SIMC_GIT_REF}) ==="; \
      git clone --depth 1 https://github.com/simulationcraft/simc.git /tmp/simc; \
      cd /tmp/simc; \
      if [ "${SIMC_GIT_REF}" != "HEAD" ]; then \
        git fetch --depth 1 origin "${SIMC_GIT_REF}" && git checkout FETCH_HEAD; \
      fi; \
      cd engine; \
      make LTO=1 NO_DEBUG=1 OPENSSL=0 -j$(nproc) OPTS="-ffast-math -fomit-frame-pointer"; \
      REF_SAFE=$(echo "${SIMC_GIT_REF}" | tr '/' '-'); \
      mkdir -p /out/source-${REF_SAFE}; \
      cp simc /out/source-${REF_SAFE}/simc; \
      chmod +x /out/source-${REF_SAFE}/simc; \
      echo "source-${REF_SAFE}" > /out/.active; \
      rm -rf /tmp/simc; \
    else \
      echo "=== Downloading pre-built SimC ==="; \
      REPO="sortbek/simc-builds"; \
      ARCH="${SIMC_ARCH:-${TARGETARCH:-}}"; \
      if [ -z "$ARCH" ]; then ARCH="$(dpkg --print-architecture)"; fi; \
      case "$ARCH" in \
          amd64|x86_64) ASSET="simc-linux-x64.tar.gz" ;; \
          arm64|aarch64) ASSET="simc-linux-arm64.tar.gz" ;; \
          *) echo "Unsupported SimC architecture: $ARCH" >&2; exit 1 ;; \
      esac; \
      echo "Using SimC asset: $ASSET ($ARCH)"; \
      ENABLED=$(printf '%s' "${SIMC_ENABLED_BRANCHES:-weekly}" | tr -d '[:space:]'); \
      [ -n "$ENABLED" ] || ENABLED="weekly"; \
      ACTIVE=""; \
      OLD_IFS=$IFS; \
      IFS=,; set -- $ENABLED; IFS=$OLD_IFS; \
      [ "$#" -gt 0 ] || set -- weekly; \
      for BRANCH in "$@"; do \
          case "$BRANCH" in \
              weekly|nightly) ;; \
              *) echo "Unknown SimC branch: $BRANCH" >&2; exit 1 ;; \
          esac; \
          if [ -f "/out/$BRANCH/.version" ]; then \
              continue; \
          fi; \
          TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/tags?per_page=100" \
              | jq -r --arg prefix "${BRANCH}-" '[.[] | select(.name | startswith($prefix))][0].name'); \
          [ "$TAG" != "null" ] && [ -n "$TAG" ] || { echo "No tag found for branch $BRANCH" >&2; exit 1; }; \
          URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
              | jq -r --arg asset "$ASSET" '.assets[] | select(.name == $asset) | .browser_download_url'); \
          echo "Downloading simc $TAG ($BRANCH)..."; \
          curl -fsSL -o /tmp/simc.tar.gz "$URL"; \
          mkdir -p /out/$BRANCH && tar -xzf /tmp/simc.tar.gz -C /out/$BRANCH; \
          chmod +x /out/$BRANCH/simc; \
          echo "$TAG" > /out/$BRANCH/.version; \
          if [ -z "$ACTIVE" ] || [ "$BRANCH" = "weekly" ]; then \
              ACTIVE="$BRANCH"; \
          fi; \
      done; \
      [ -n "$ACTIVE" ] || ACTIVE="weekly"; \
      echo "$ACTIVE" > /out/.active; \
    fi

# --- WoW Forever engine (optional: an outage leaves it empty, the API then answers 503) ---
FROM debian:bookworm-slim AS forever
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
RUN set -eu; mkdir -p /out; \
    case "$TARGETARCH" in arm64) ASSET=simhammer-forever-linux-arm64.tar.gz ;; *) ASSET=simhammer-forever-linux-x64.tar.gz ;; esac; \
    TAG=$(curl -fsSI --max-time 20 https://github.com/sortbek/forever-builds/releases/latest | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/releases/tag/\(.*\)$#\1#p') || true; \
    echo "$TAG" | grep -Eq '^forever-[0-9]{8}-[0-9a-f]+$' || TAG=""; \
    if [ -n "$TAG" ] && mkdir -p "/out/$TAG" \
       && curl -fsSL "https://github.com/sortbek/forever-builds/releases/download/$TAG/$ASSET" | tar -xz -C "/out/$TAG" \
       && chmod 755 "/out/$TAG/simhammer-forever"; then \
      echo "$TAG" > /out/.active; \
    else \
      rm -rf /out/*; echo "Forever engine unavailable at build time"; \
    fi

# --- Runtime ---
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq bash locales && rm -rf /var/lib/apt/lists/* \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8

COPY --from=builder /build/target/release/simhammer-server /usr/local/bin/simhammer-server
COPY --from=simc /out/ /app/resources/simc/
COPY --from=forever /out/ /app/resources/forever/
COPY --from=fetcher /data/compact /app/resources/data
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app
ENV DATA_DIR=/app/resources/data
ENV SIMC_DIR=/app/resources/simc
ENV FOREVER_DIR=/app/resources/forever
ENV PORT=8000

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["simhammer-server"]
