FROM ubuntu@sha256:829f6df217bcbae2b371026e81711d1a787c61b2967ad09d015063663ebafbf7

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    build-essential \
    ca-certificates \
    libglib2.0-dev \
    ninja-build \
    pkg-config \
    python3-pip \
    xz-utils \
  && python3 -m pip install --no-cache-dir meson==1.11.1 \
  && rm -rf /var/lib/apt/lists/*

COPY build.sh /usr/local/bin/build-vendored-harfbuzz
RUN chmod 0755 /usr/local/bin/build-vendored-harfbuzz

ENTRYPOINT ["/usr/local/bin/build-vendored-harfbuzz"]
