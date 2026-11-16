# Coffee Gremlin Pack Design

**Date:** 2026-09-24
**Pack name:** `coffee-gremlin`
**Branch:** feat/ceap-animation-pack

---

## Concept

A small, frantic pixel-art gremlin (goblin-adjacent — big bat ears, manic eyes, wide
toothy grin, mottled green-yellow skin) perched on a tall stool at an oversized desk,
surrounded by coffee cups. The desk being too big for the gremlin reads immediately at
a glance and emphasizes the chaos. Warm chaotic palette: yellows, browns, red-orange.

`typing` has **3 variants** at different caffeine levels. This is the only pack to
demonstrate a 3-variant category, where the candidate pool on each transition is always
2 of the 3 (all except last played).

**CEAP features exercised:**
- 3 variants on `typing` — the max variant exercise
- Split-files authoring, with the unhinged variant having 8 frames vs 6
- Animated border with `margin`
- All 6 categories
- `dot_colors`, `corner_radius`, `render_density`
- **No `bg`** — exercises the "omit bg" fallback path (no background layer renders)

---

## Atlas Spec

- **Per-frame size:** 400×400 px native
- **Authoring style:** Split files — one strip per category/variant
- **`render_density`:** 2.0 → 200 CSS px on-screen (retina: 400 native px fills 400 physical px at @2x)
- **`corner_radius`:** 12 native px → 6 CSS px — gently rounded

| File | Category / Role | Frames | FPS | Loop | Strip size |
|---|---|---|---|---|---|
| `sleeping.png` | sleeping | 6 | 3 | yes | 2400×400 |
| `waking.png` | waking | 6 | 8 | no (loops: 1) | 2400×400 |
| `typing-normal.png` | typing variant 1 | 6 | 8 | yes | 2400×400 |
| `typing-overcaffeinated.png` | typing variant 2 | 6 | 14 | yes | 2400×400 |
| `typing-unhinged.png` | typing variant 3 | 8 | 20 | yes | 3200×400 |
| `alarmed.png` | alarmed | 6 | 10 | no | 2400×400 |
| `celebrate.png` | celebrate | 6 | 12 | no | 2400×400 |
| `annoyed.png` | annoyed | 6 | 8 | no | 2400×400 |
| `borders.png` | animated border | 6 | 8 | yes | 2400×400 |
| `dock-icon.png` | dock icon source | — | — | — | 1024×1024 |

No `bg.png` — this pack omits the background layer entirely.

---

## Manifest

```json
{
  "ceap_version": "1.0",
  "name": "coffee-gremlin",
  "display_name": "Coffee Gremlin",
  "version": "1.0.0",
  "author": { "name": "peon-pet team" },
  "license": "CC-BY-NC-4.0",
  "render_density": 2.0,
  "corner_radius": 12,
  "dot_colors": {
    "hot":  "rgba(255, 160, 20, 1.0)",
    "warm": "rgba(255, 160, 20, 0.25)",
    "off":  "rgba(40, 30, 15, 1.0)"
  },
  "categories": {
    "sleeping":  [{ "file": "sleeping.png", "frames": 6, "fps": 3, "loop": true }],
    "waking":    [{ "file": "waking.png",   "frames": 6, "fps": 8, "loop": false, "loops": 1 }],
    "typing": [
      { "file": "typing-normal.png",          "frames": 6, "fps": 8,  "label": "normal" },
      { "file": "typing-overcaffeinated.png", "frames": 6, "fps": 14, "label": "overcaffeinated" },
      { "file": "typing-unhinged.png",        "frames": 8, "fps": 20, "label": "unhinged" }
    ],
    "alarmed":   [{ "file": "alarmed.png",   "frames": 6, "fps": 10 }],
    "celebrate": [{ "file": "celebrate.png", "frames": 6, "fps": 12 }],
    "annoyed":   [{ "file": "annoyed.png",   "frames": 6, "fps": 8  }]
  },
  "assets": {
    "icons": {
      "macos": {
        "icon_512x512": { "file": "dock-icon-squircle.png" },
        "default":      { "file": "dock-icon.png" }
      },
      "default": { "file": "dock-icon.png" }
    },
    "borders": { "file": "borders.png", "frames": 6, "fps": 8, "loop": true, "margin": { "x": 18, "y": 18 } }
  }
}
```

---

## Directory Structure

```
renderer/assets/coffee-gremlin/
  openpeon.json
  sleeping.png                (2400×400)
  waking.png                  (2400×400)
  typing-normal.png           (2400×400)
  typing-overcaffeinated.png  (2400×400)
  typing-unhinged.png         (3200×400)
  alarmed.png                 (2400×400)
  celebrate.png               (2400×400)
  annoyed.png                 (2400×400)
  borders.png                 (2400×400)
  dock-icon.png               (1024×1024 source)
  dock-icon-squircle.png      (generated)
  icons/macos/                (generated)
```

---

## AI Generation Prompts

Use with DALL-E 3, GPT-4o image generation, or Midjourney.
Generate each strip separately. Maintain character consistency across generations.

### Character Description (include in every prompt)

```
CHARACTER: Pixel art gremlin. Small body (half the size of a normal person). Big
bat-like ears. Huge manic eyes (pupils like pinpoints). Wide toothy grin with small
fangs. Mottled green-yellow skin. Wearing a stained brown apron with visible coffee
splatter marks. Perched on a tall wooden stool at an oversized wooden desk — the
desk is intentionally too large for the gremlin, emphasizing small chaotic energy.
On the desk: 2-3 ceramic coffee mugs in various states (some full, some tipping,
some empty). A standard laptop (small relative to the desk). Crumpled papers scattered
around. Warm chaotic color palette: yellows, browns, orange-red, dark coffee brown.
The gremlin faces the viewer (camera slightly elevated in front), fixed view.
Pixel art style with clean outlines. Transparent background (RGBA PNG).
Character and desk are at the EXACT same angle in ALL frames.
Camera position NEVER moves between frames.
```

### sleeping.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — SLEEPING (loops):
Gremlin face-down, snout resting on the rim of a large coffee mug. Coffee steam rises
from the mug in frames 3-4. Z, ZZ, ZZZ speech bubbles cycling upward (Z in frame 1,
ZZZ in frame 4, back to Z in frame 6). One large ear twitches in frames 2 and 5 (flicks
slightly up then drops). Paws flat on the desk, apron rumpled.
```

### waking.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — WAKING (plays once):
Frame 1: Face in mug, ZZZ bubble.
Frame 2: Head pops up with a start, coffee dripping from snout, ZZZ fading.
Frame 3: Coffee mug gets knocked over (tipping, liquid starting to spill on desk).
Frame 4: Gremlin grabs the desk edge with both paws for balance.
Frame 5: Big manic eyes fully open, huge grin, coffee dripping off chin.
Frame 6: Fully alert, perched upright on stool, gripping laptop with both paws.
```

### typing-normal.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — TYPING NORMAL (loops):
Gremlin typing methodically. ONE coffee mug nearby, mostly full. Sitting semi-upright
on the stool. Claws typing with one claw per key in a deliberate but slightly awkward
rhythm. Eyes scanning screen, expression focused. Ears upright. Surprisingly calm for
a gremlin — this is baseline.
```

### typing-overcaffeinated.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — TYPING OVERCAFFEINATED (loops):
Gremlin typing fast. THREE coffee mugs visible, one empty tipped over. Leaning far
forward, eyes very wide, claws a blur across the keyboard. Papers starting to slide
off the desk. Stool rocking very slightly (gremlin's heels drumming in excitement).
Big manic grin. Ears flat from the wind of the motion.
```

### typing-unhinged.png — 3200×400 (8 frames × 400 px)

```
Pixel art sprite sheet strip. 8 frames. Each cell 400×400 pixels.
Total image: 3200×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — TYPING UNHINGED (loops):
Gremlin has achieved full caffeinated transcendence. Multiple coffee mugs, some actively
tipping. The desk shakes (alternate frames shift the entire scene 1-2 pixels left/right).
The gremlin is a motion blur — barely recognizable as distinct from the keyboard,
smashing keys with both paws simultaneously. Papers flying in all directions.
Coffee sloshing out of mugs. Stool at 30-45 degree angle from momentum.
Eyes impossibly wide. Grin stretching from one giant ear to the other.
Frames 7-8: peak chaos — the gremlin appears to be halfway off the stool but still typing.
```

### alarmed.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — ALARMED (plays once):
Frame 1: Normal typing.
Frame 2: Eyes snap to screen with horror. Typing stops.
Frame 3: Gremlin leaps off the stool entirely, airborne above it, arms flailing.
          Coffee flying from a nearby mug knocked by the leap.
Frame 4: Lands back on stool in a panic crouch, gripping the stool seat.
Frame 5: Both paws pointing at the laptop screen, mouth open wide.
Frame 6: Slowly backing away on the stool, eyes wide, one paw over mouth.
```

### celebrate.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — CELEBRATE (plays once):
Frame 1: Normal.
Frame 2: Sudden jump — gremlin bouncing in place on the stool.
Frame 3: Gremlin running in a tiny frantic circle on the desk surface (too excited to sit).
Frame 4: Still running in circles, crumpling a paper under paw.
Frame 5: Throws a coffee mug into the air (mug flying upward out of frame).
Frame 6: Back on the stool, arms raised, huge grin, triumphant — possibly still airborne.
```

### annoyed.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — ANNOYED (plays once):
Frame 1: Normal.
Frame 2: Stares at screen, face starting to scrunch, brow furrowing.
Frame 3: Slams one paw on desk. A coffee mug rattles and sloshes.
Frame 4: Arms crossed, pouting expression, ears flat against head.
Frame 5: Face fully scrunched, one eye twitching, teeth showing in a grimace.
Frame 6: Slumped dramatically over the keyboard, face-first, defeated. One paw
          hanging off the desk limply.
```

### borders.png — 2400×400 (6 frames × 400 px)

```
Pixel art animated border strip. 6 frames. Each frame: 400×400 pixels.
Total image: 2400×400. No borders or labels between cells.

The border is a picture-frame overlay the same size as the sprite (400×400 px).
The center is transparent so the sprite shows through underneath.
The opaque ring is ~18 px wide on each side — the sprite's rendered area is pushed
inward by this margin. Adjust thickness to taste after seeing the art.

The border ring contains: warm wooden picture frame texture (pixel art). The wood has
visible grain, a warm honey-brown color, and small coffee ring stains at irregular
positions. The grain should look like a slightly battered picture frame.

At the bottom-left and bottom-right corners of the frame, small steam wisps rise
upward — as if from coffee mugs just outside the frame below:
- Frames 1-2: wisps thin and low, just barely curling upward
- Frames 3-4: wisps curl higher and wider, the fullest they get
- Frames 5-6: wisps dissipate and thin out, resetting toward frames 1-2

The wisps are white/cream with slight transparency. No anti-aliasing, hard pixel edges
on the wood grain; wisps can have softer pixel edges to suggest translucency.
```

### dock-icon.png — 1024×1024 (static)

```
Pixel art portrait icon. 1024×1024 pixels. The gremlin's face and ears only.
Centered on a warm dark brown background (dark coffee brown, like #2a1a0a).
Huge manic eyes. Wide toothy grin. Big bat ears extending to the corners.
Green-yellow mottled skin. Coffee splatter droplets on chin and apron collar visible
at the bottom. Warm amber-orange glow from below (coffee steam implied).
Follow Apple icon spec: main content in ~824×824 center area with ~100 px margins.
No transparency — fill the full 1024×1024 with the background.
```

---

## Notes

- No `bg` in this pack. The manifest has no `bg` key under `assets`. The player renders
  with no background layer — just the transparent sprite on the desktop. Confirms the
  omit-bg code path.
- `typing-unhinged.png` is 8 frames at 20 fps — the fastest animation in any bundled
  pack. Exercises the high end of the fps range.
- The 3-variant `typing` means: on each session start, the candidate pool is the 2 variants
  that were NOT played last time. With 3 variants, over a long session, the player should
  cycle through all three but never play the same one twice in a row.
- **Retina:** 400px native / density 2.0 = 200 CSS px on-screen. 400 physical pixels at @2x — 1:1 mapping.
- **Border model:** border and sprite share the same window. `margin: { x: 18, y: 18 }` (native px)
  pushes the sprite inward by 9 CSS px on each side, making room for the steam-wisp ring.
  The window stays the same size bordered or not. Adjust after seeing the actual art.
- `corner_radius: 12` at density 2.0 = 6 CSS px — small, gently rounds the corners.
- Run `node scripts/generate-dock-icons.js` after placing `dock-icon.png`.
