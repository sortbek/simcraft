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

# --- Build SimulationCraft from source ---
FROM debian:bookworm-slim AS simc-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libcurl4-openssl-dev \
    libssl-dev \
    git \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Pin to a specific commit — Docker caches this layer until the hash changes.
# Update SIMC_VERSION to rebuild with a newer SimC version.
ARG SIMC_VERSION=HEAD
RUN git clone --depth 1 https://github.com/simulationcraft/simc.git /tmp/simc \
    && cd /tmp/simc \
    && if [ "$SIMC_VERSION" != "HEAD" ]; then git fetch --depth 1 origin "$SIMC_VERSION" && git checkout FETCH_HEAD; fi \
    && cd engine \
    && make LTO=1 NO_DEBUG=1 SC_NO_NETWORKING=1 -j$(nproc) OPTS="-ffast-math -fomit-frame-pointer" \
    && cp simc /usr/local/bin/simc \
    && rm -rf /tmp/simc

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl locales && rm -rf /var/lib/apt/lists/* \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8

COPY --from=builder /build/target/release/simhammer-server /usr/local/bin/simhammer-server
COPY --from=simc-builder /usr/local/bin/simc /usr/local/bin/simc
COPY --from=fetcher /data/compact /app/resources/data

WORKDIR /app
ENV DATA_DIR=/app/resources/data
ENV SIMC_PATH=/usr/local/bin/simc
ENV PORT=8000

EXPOSE 8000

CMD ["simhammer-server"]
