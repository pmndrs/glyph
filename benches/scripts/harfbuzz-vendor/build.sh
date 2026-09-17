#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d /source || ! -d /output ]]; then
  printf 'mount HarfBuzz source at /source and a writable output directory at /output\n' >&2
  exit 2
fi

rm -rf /output/build
meson setup /output/build /source \
  --buildtype=release \
  --default-library=static \
  --prefer-static \
  -Db_lto=true \
  -Dcairo=disabled \
  -Dchafa=disabled \
  -Dcoretext=disabled \
  -Ddirectwrite=disabled \
  -Ddocs=disabled \
  -Dfreetype=disabled \
  -Dglib=enabled \
  -Dgobject=disabled \
  -Dgraphite2=disabled \
  -Dicu=disabled \
  -Dintrospection=disabled \
  -Draster=disabled \
  -Dtests=disabled \
  -Dutilities=enabled \
  -Dvector=disabled \
  -Dwasm=disabled \
  ${HARFBUZZ_GPU_OPTION:-}
meson compile -C /output/build hb-shape hb-subset hb-info

mkdir -p /output/provenance
cc --version | head -1 > /output/provenance/compiler.txt
meson --version > /output/provenance/meson.txt
pkg-config --modversion glib-2.0 > /output/provenance/glib.txt
dpkg-query --showformat='${Package}=${Version}\n' --show \
  build-essential libglib2.0-dev ninja-build pkg-config python3-pip > /output/provenance/packages.txt
for utility in hb-shape hb-subset hb-info; do
  strip --strip-unneeded "/output/build/util/${utility}"
  "/output/build/util/${utility}" --version > "/output/provenance/${utility}.version"
  ldd "/output/build/util/${utility}" > "/output/provenance/${utility}.ldd"
done
cp /usr/share/doc/libglib2.0-0/copyright /output/provenance/glib-copyright.txt
