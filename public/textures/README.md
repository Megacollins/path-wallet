# Path — luxury texture assets

Drop real image assets here and the UI upgrades from procedural (drawn) to
**photoreal** automatically. Nothing breaks while a file is missing — a 404 just
falls back to the built-in SVG version.

**Where each file shows up:**

| Filename (exact) | Format | Size | Used for |
|---|---|---|---|
| `marble-black.jpg` | JPG, seamless/tileable | 2048² | Hero card, wallet cards, sidebar, USDC/wUSDC tiles, backdrop |
| `marble-white.jpg` | JPG, seamless | 2048² | The arch niche frame (Calacatta) |
| `marble-rosso.jpg` | JPG, seamless | 1024² | SOL / ETH asset tiles |
| `gold-sculpture.png` | PNG **transparent bg** | ~1000² | The centerpiece sculpture in the marble arch (`/showcase`) |
| `column-left.png` | PNG **transparent bg** | tall (e.g. 800×1600) | Left Roman column, full-height |
| `column-right.png` | PNG **transparent bg** | tall | Right Roman column (or reuse/mirror the left) |
| `backdrop.jpg` | JPG | 2560×1440 | Blurred marble atmosphere behind the stage |

Only add the ones you want — each is independent.

## Generating them (same tool that made your reference images)

Use "no text", "no watermark", and ask for a **transparent background** on the PNGs.

- **marble-black.jpg** — `seamless tileable black Portoro marble slab, fine natural gold veins, top-down flat lay, soft studio lighting, high detail, photographic, no text`
- **marble-white.jpg** — `seamless tileable Calacatta white marble, subtle grey and gold veining, top-down, studio lit, photographic, no text`
- **marble-rosso.jpg** — `seamless tileable Rosso Levanto red marble, cream and white veins, top-down, photographic, no text`
- **gold-sculpture.png** — `a polished 24k gold sculptural object, luxury, studio product render, dramatic rim light, reflective metal, centered, on a fully transparent background, PNG` (a gold teardrop, orb, laurel, or the letter "P" — your call)
- **column-left.png** — `a single classical Roman marble Corinthian column, full height, black marble with gold veins, dramatic side lighting, isolated on a fully transparent background, PNG`
- **backdrop.jpg** — `dark luxury interior, blurred black marble wall with gold veins and faint Roman columns, cinematic moody lighting, bokeh, 16:9`

## Tips for the closest match to the reference

- Keep marble **dark and high-contrast** (deep black, bright thin gold veins) — that's the Portoro look in your reference.
- For the sculpture PNG, a clean transparent cutout matters most; the app adds the glow, shadow, and marble niche around it.
- 2K textures look crisp on retina without being heavy. Compress JPGs to ~300–600 KB.
