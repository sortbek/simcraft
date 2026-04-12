FROM rust:1.88-bookworm AS builder

WORKDIR /build

# Copy workspace files
COPY Cargo.toml ./
COPY core/ core/
COPY server/ server/

ARG CARGO_FEATURES=
RUN cargo build --release -p simhammer-server ${CARGO_FEATURES:+--features $CARGO_FEATURES}

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
RUN node /compact-data.js /data/full /data/compact

# --- Download SimC from GitHub Releases ---
FROM debian:bookworm-slim AS simc-fetcher

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq && rm -rf /var/lib/apt/lists/*

ARG SIMC_BRANCH=weekly
ARG SIMC_VERSION=
RUN set -e; \
    REPO="sortbek/simc-builds"; \
    ASSET="simc-linux-x64.tar.gz"; \
    if [ -n "$SIMC_VERSION" ]; then \
        TAG="$SIMC_VERSION"; \
        RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG"); \
        BRANCH=$(echo "$TAG" | sed 's/-.*//' ); \
    else \
        BRANCH="$SIMC_BRANCH"; \
        RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
            | jq -r --arg prefix "${BRANCH}-" '[.[] | select(.tag_name | startswith($prefix))][0]'); \
        TAG=$(echo "$RELEASE" | jq -r '.tag_name'); \
    fi; \
    URL=$(echo "$RELEASE" | jq -r --arg asset "$ASSET" '.assets[] | select(.name == $asset) | .browser_download_url'); \
    echo "Downloading simc $TAG ($BRANCH)..."; \
    curl -fsSL -o /tmp/simc.tar.gz "$URL"; \
    mkdir -p /out/$BRANCH && tar -xzf /tmp/simc.tar.gz -C /out/$BRANCH; \
    chmod +x /out/$BRANCH/simc; \
    echo "$TAG" > /out/$BRANCH/.version; \
    echo "$BRANCH" > /out/.active

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl locales && rm -rf /var/lib/apt/lists/* \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8

COPY --from=builder /build/target/release/simhammer-server /usr/local/bin/simhammer-server
COPY --from=simc-fetcher /out/ /app/resources/simc/
COPY --from=fetcher /data/compact /app/resources/data

WORKDIR /app
ENV DATA_DIR=/app/resources/data
ENV SIMC_DIR=/app/resources/simc
ENV PORT=8000

EXPOSE 8000

CMD ["simhammer-server"]
