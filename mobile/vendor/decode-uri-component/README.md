# CommonJS compatibility for the patched decoder

Upstream `decode-uri-component` 0.5.1 fixes GHSA-qr28-fpjm-wq7f, but publishes
ES modules only. Expo Router 57 uses CommonJS `query-string` 7, which calls
`require("decode-uri-component")` directly. A plain 0.5.1 override breaks parsing.

This is the MIT-licensed upstream npm 0.5.1 `index.js`, changing only
`export default function` to `module.exports = function` (plus the closing
semicolon). The original license is preserved. No algorithm changes.
Upstream source SHA-256: `6a86ac891edf15c5efa0841ebb31935e3669d58b98318b57d7b08a4530317cb0`.

The `test:uri-decoder` gate exercises the actual query-string consumer, Unicode,
malformed inputs, repeated parameters and a long malformed escape run. Remove
this adapter when Expo Router adopts a compatible patched dependency graph.
