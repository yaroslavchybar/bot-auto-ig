# syntax=docker/dockerfile:1.7
FROM rust:1.98.1-bookworm AS rust-build
WORKDIR /build
COPY --from=repo_root Cargo.toml Cargo.lock ./
COPY --from=repo_root tools ./tools
RUN --mount=type=cache,target=/usr/local/cargo/registry \
  --mount=type=cache,target=/usr/local/cargo/git \
  cargo build --release --locked -p ig-runtime

FROM debian:bookworm-slim
COPY --from=rust-build /build/target/release/ig-runtime /usr/local/bin/ig-runtime
ENV LOG_SERVICE=gateway
EXPOSE 3003
CMD ["ig-runtime", "gateway"]
