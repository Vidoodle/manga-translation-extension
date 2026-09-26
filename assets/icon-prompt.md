# Extension icon

The original vector mark in `extension-mark.svg` combines an open book and a speech bubble. It uses broad solid shapes and a clear central fold so it remains readable at 16 pixels. There is no lettering or miniature illustration.

## Build

`scripts/build-icons.cjs` renders the mark directly at each final size with Sharp. The forest-green tile is used in the popup and add-on listing. Transparent dark-ink and light-paper variants are used in Firefox's toolbar; `action.theme_icons` selects the matching foreground for the browser theme. Mozilla's `dark` key means dark artwork for a light toolbar, and `light` means light artwork for a dark toolbar.

To rebuild, make the `sharp` Node package available (locally or through `NODE_PATH`) and run `node scripts/build-icons.cjs`. The generated PNGs in `src/icons` and the 512px listing image `extension-icon.png` are committed assets, so users do not need a build step. `extension-icon.svg` is the generated scalable brand tile.
