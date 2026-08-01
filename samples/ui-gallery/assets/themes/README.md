# UI gallery theme sources

Each theme has an `atlas.png` containing the art used by the minimotor UI
gallery. `atlas.json` documents source provenance and packing; selected themes
also have a `theme.json` semantic manifest consumed by the gallery and its atlas
inspector.

| Theme                    | Source                                              | License |
| ------------------------ | --------------------------------------------------- | ------- |
| Kenney Pixel UI          | https://www.kenney.nl/assets/pixel-ui-pack          | CC0 1.0 |
| Kenney Pixel Adventure   | https://kenney.nl/assets/ui-pack-pixel-adventure    | CC0 1.0 |
| Tiny RPG - Mana Soul GUI | https://tiopalada.itch.io/tiny-rpg-mana-soul-gui    | CC0 1.0 |
| Hexany's 1-bit UI Panels | https://hexany-ives.itch.io/hexanys-1-bit-ui-panels | CC0 1.0 |
| Paper Pixels             | https://v3x3d.itch.io/paper-pixels                  | CC0 1.0 |

The small `visuals` atlas contains the HUD frame, divider, and cursor. The
Kenney atlas is a dense, spacing-free copy of the pack's 16px transparent
sheet. It retains every source tile at native size, including the five color
families, panels/inputs, buttons and states, checkboxes, radio controls, arrows,
sliders, and scrollbar parts. The Hexany and Paper atlases contain their single
source sheets. The Tiny RPG atlas contains panels, title strips, tabs, button
variants, bars, and the cursor in readable rows.

`theme.json` follows MiniMotor's JSON-friendly
`createTilesetSkinFromManifest()` shape. `inspectTilesetSkin()` extracts the
debug regions automatically from the resulting skin, so no theme-specific
debug list is maintained.

The bundled fonts are from the Google Fonts families Press Start 2P, Pixelify
Sans, DotGothic16, and VT323, plus Tiny5 from
https://github.com/Gissio/font_Tiny5. Their OFL text is retained beside each
font file. The comparison-only bitmap fonts m5x7 and Monogram are CC0; their
source and license notes are retained beside the files. DePixel Schmal is
included from the author's DaFont distribution with its bundled EULA; review
that EULA before redistributing it outside this sample.
