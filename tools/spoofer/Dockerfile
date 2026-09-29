# syntax=docker/dockerfile:1.7
FROM rust:1-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM oven/bun:1.4.2-debian
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/spoof /usr/local/bin/spoof
COPY service.ts /app/tools/spoofer/service.ts
COPY --from=repo_root server/shared/httpLogging.ts server/shared/loggingTypes.ts server/shared/loggingSanitize.ts /app/server/shared/
WORKDIR /app
EXPOSE 3002
CMD ["bun", "tools/spoofer/service.ts"]
