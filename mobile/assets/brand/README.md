# CSG Connect icon sources

These SVG files are the editable vector sources for the generated PNG assets in `../images`.

- `icon-light.svg` — default iOS and legacy full icon
- `icon-dark.svg` — iOS dark appearance
- `icon-tinted.svg` — grayscale iOS tinted appearance source
- `icon-foreground.svg` — transparent Android adaptive foreground and splash source
- `icon-monochrome.svg` — Android themed and notification icon source

Regenerate the PNG exports from the repository root:

```bash
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-light.svg -o mobile/assets/images/icon.png
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-light.svg -o mobile/assets/images/icon-light.png
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-dark.svg -o mobile/assets/images/icon-dark.png
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-tinted.svg -o mobile/assets/images/icon-tinted.png
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-foreground.svg -o mobile/assets/images/icon-foreground.png
rsvg-convert -w 1024 -h 1024 mobile/assets/brand/icon-monochrome.svg -o mobile/assets/images/icon-monochrome.png
rsvg-convert -w 512 -h 512 mobile/assets/brand/icon-foreground.svg -o mobile/assets/images/splash-icon.png
rsvg-convert -w 96 -h 96 mobile/assets/brand/icon-monochrome.svg -o mobile/assets/images/notification-icon.png
```

Do not add rounded corners to source or exported icon canvases. The operating system applies its own mask.
