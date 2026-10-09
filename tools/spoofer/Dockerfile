# syntax=docker/dockerfile:1.7
FROM rust:1.98.1-bookworm AS chef
WORKDIR /build
RUN cargo install cargo-chef --version 0.1.78 --locked

FROM chef AS rust-planner
COPY --from=repo_root Cargo.toml Cargo.lock ./
COPY --from=repo_root tools ./tools
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS rust-build
COPY --from=rust-planner /build/recipe.json recipe.json
RUN cargo chef cook --release --locked --package spoof --recipe-path recipe.json
COPY --from=repo_root Cargo.toml Cargo.lock ./
COPY --from=repo_root tools/runtime/Cargo.toml ./tools/runtime/Cargo.toml
COPY --from=repo_root tools/spoofer ./tools/spoofer
COPY --from=repo_root tools/service-common ./tools/service-common
RUN cargo build --release --locked -p spoof

FROM debian:bookworm-slim
COPY --from=rust-build /build/target/release/spoof /usr/local/bin/spoof
WORKDIR /app
EXPOSE 3002
CMD ["spoof", "serve"]
