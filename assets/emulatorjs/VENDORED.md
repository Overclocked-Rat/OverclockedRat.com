# Vendored EmulatorJS — provenance

Do not hand-edit anything in `data/`. It is third-party vendored code.

- **Upstream:** https://github.com/EmulatorJS/EmulatorJS
- **Version:** v4.2.3 (released 2025-07-05) — latest *stable*.
  (v4.3.0-pre exists but is a prerelease; not used here.)
- **Source archive:** `4.2.3.7z`
- **sha256 of that archive:** `07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b`
- **License:** GPL-3.0 — see `LICENSE` in this folder. It must stay here.

## What was trimmed and why

The upstream release is ~290 MB because it ships 187 core variants for every
supported system. Only the GBA (mGBA) cores were kept:

- KEPT `data/cores/mgba-wasm.data`         — standard core
- KEPT `data/cores/mgba-legacy-wasm.data`  — auto-selected on browsers without
                                             WebGL2. Required; do not delete.
                                             See `emulator.js`: the filename is
                                             built as
                                             `core + (threads?"-thread":"") + (webgl2?"":"-legacy") + "-wasm.data"`
- REMOVED `mgba-thread-wasm.data` and `mgba-thread-legacy-wasm.data`
  Threaded cores need `SharedArrayBuffer`, which requires COOP/COEP response
  headers. GitHub Pages cannot set custom headers, so these can never work here.
  Leave `EJS_threads` unset.

Everything outside `data/cores/` was kept as-is (loader, emulator runtime,
localization, compression helpers for zipped/7z/rar ROMs).

## Adding another system later

Download the same release, and copy in the two matching core files, e.g. for
SNES: `snes9x-wasm.data` and `snes9x-legacy-wasm.data`. Each pair is ~2 MB.
Note that `ppsspp` and `dosbox_pure` require threads and therefore cannot be
hosted on GitHub Pages at all.

## Bandwidth note

Each first-time visitor downloads roughly 1.5 MB of core plus ~0.5 MB of
runtime. GitHub Pages' soft bandwidth limit is 100 GB/month.
