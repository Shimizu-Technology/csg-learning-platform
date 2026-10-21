# CSG Learn brand sources

The official logo is reconstructed from `web/public/CSG-Logo.png` (500×500).
The sampled flat colors are sage `#7d8b68`, tile `#191920`, and lettering
`#fcfbfc`. No replacement font is required at build or runtime.

`csg-mark.svg` is geometric: an eight-position gear with five surviving teeth,
45° spacing, center (175.5,245.5), ring radii 69.5/50.9, tooth width32.5,
outer radius88, corner radius3.5, and a roughly124° opening (inner132°).
The oblique terminal cuts reproduce the source rather than using a radial cut.
`csg-lockup.svg` retains the full official composition. `csg-lettering.svg`
contains the original serif outlines. A specific open-licensed font could not
be verified; these are cleaned Potrace1.16 outlines of the source lettering at
4× upscale, not a substitute font or an automatic trace of the gear.

Candidate A combines the C with the original SG outlines, B is the gear alone,
and C stacks the gear and CSG. A is selected: SG stays readable at60px, and
at29px the gear remains recognizable with the initials. C's stacked lettering
is smaller. Keep the tile square: the operating system applies its own mask.

From `mobile/`, run:

```bash
npm ci
npm run brand:generate
npm run brand:check
# Optional candidate sheet, Android masks, fidelity overlay/diff, asset manifest:
node scripts/generate-brand-assets.mjs --evidence /absolute/output/directory
```

Sharp is a pinned development dependency. All icon/splash/notification/favicon
PNGs and Android store images derive from these SVG sources. `brand:check`
checks dimensions, alpha, white silhouettes, grayscale tint, pixel freshness,
and the Android66/108 safe circle. It also checks the Play PNGs and every generated documentation SVG copy for missing/stale output. The feature graphic copy uses committed Manrope outlines in `play-feature-copy.svg` (from the existing font package under the SIL Open Font License), so generation needs no system font. On macOS it also decodes every image with
`sips`. The icon dark background is transparent; tinted is white on black.
Splash sources use dark ink on cream in light appearance and white on the dark
tile in dark appearance. Notification uses only the simple white gear silhouette.

The sign-in `CsgMark` uses the same geometry through the existing
`react-native-svg` dependency. Keep it in sync with `csg-mark.svg`.
