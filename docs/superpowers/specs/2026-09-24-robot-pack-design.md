# Robot Pack Design

**Date:** 2026-09-24
**Pack name:** `robot`
**Branch:** feat/ceap-animation-pack

---

## Concept

A bulky pixel-art robot seated at a minimalist white desk: matte steel-grey body with
dark panel lines, large round LED eyes (cyan), a chest panel with indicator lights, and
articulated metal fingers. Cool blue-white server room background. Total aesthetic
contrast to the warm dungeon packs — clean and mechanical.

**CEAP features exercised:**
- Multiple variants on **`sleeping`** (low-power vs standby) — the only pack to demonstrate
  multi-variant on a steady state, which is the most unusual case in the spec
- Split-files authoring
- Animated border with `margin`
- All 6 categories
- `dot_colors`, `corner_radius: 0` (square — explicit suppression), `render_density`
- `bg` layer

---

## Atlas Spec

- **Per-frame size:** 400×400 px native
- **`render_density`:** 2.0 → 200 CSS px on-screen (retina: 400 native px fills 400 physical px at @2x)
- **`corner_radius`:** 0 — square corners, fitting the mechanical aesthetic; explicitly suppresses OS rounding
- **Authoring style:** Split files — one strip per category/variant, no shared atlas

`sleeping` has **2 variants**: "low-power" (4 frames, very slow) and "standby" (6 frames,
slightly faster). Different frame counts between the two sleeping variants exercises the
per-file independence. The player picks randomly between them (with no-immediate-repeat)
on every transition back to sleep.

**Border:** 400×400 px per frame, same size as the sprite. Overlaid on top with a transparent
center. `margin` is an estimate of the opaque ring half-width in native px — adjust after
seeing the art. The circuit sweep is thin (~12 native px), so `margin: { x: 12, y: 12 }`.

| File | Category / Role | Frames | FPS | Loop | Strip size |
|---|---|---|---|---|---|
| `sleeping-low-power.png` | sleeping variant 1 | 4 | 2 | yes | 1600×400 |
| `sleeping-standby.png` | sleeping variant 2 | 6 | 3 | yes | 2400×400 |
| `waking.png` | waking | 6 | 8 | no (loops: 1) | 2400×400 |
| `typing.png` | typing | 6 | 10 | yes | 2400×400 |
| `alarmed.png` | alarmed | 6 | 12 | no | 2400×400 |
| `celebrate.png` | celebrate | 6 | 10 | no | 2400×400 |
| `annoyed.png` | annoyed | 6 | 8 | no | 2400×400 |
| `borders.png` | animated border | 6 | 12 | yes | 2400×400 |
| `bg.png` | background | 1 | — | — | 400×400 |
| `dock-icon.png` | dock icon source | — | — | — | 1024×1024 |

---

## Manifest

```json
{
  "ceap_version": "1.0",
  "name": "robot",
  "display_name": "Robot",
  "version": "1.0.0",
  "author": { "name": "peon-pet team" },
  "license": "CC-BY-NC-4.0",
  "render_density": 2.0,
  "corner_radius": 0,
  "dot_colors": {
    "hot":  "rgba(0, 220, 255, 1.0)",
    "warm": "rgba(0, 220, 255, 0.25)",
    "off":  "rgba(20, 20, 30, 1.0)"
  },
  "categories": {
    "sleeping": [
      { "file": "sleeping-low-power.png", "frames": 4, "fps": 2, "loop": true, "label": "low-power" },
      { "file": "sleeping-standby.png",   "frames": 6, "fps": 3, "loop": true, "label": "standby"   }
    ],
    "waking":    [{ "file": "waking.png",    "frames": 6, "fps": 8,  "loop": false, "loops": 1 }],
    "typing":    [{ "file": "typing.png",    "frames": 6, "fps": 10 }],
    "alarmed":   [{ "file": "alarmed.png",   "frames": 6, "fps": 12 }],
    "celebrate": [{ "file": "celebrate.png", "frames": 6, "fps": 10 }],
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
    "borders": { "file": "borders.png", "frames": 6, "fps": 12, "loop": true, "margin": { "x": 12, "y": 12 } },
    "bg":      { "file": "bg.png" }
  }
}
```

---

## Directory Structure

```
renderer/assets/robot/
  openpeon.json
  sleeping-low-power.png  (1600×400)
  sleeping-standby.png    (2400×400)
  waking.png              (2400×400)
  typing.png              (2400×400)
  alarmed.png             (2400×400)
  celebrate.png           (2400×400)
  annoyed.png             (2400×400)
  borders.png             (2400×400)
  bg.png                  (400×400)
  dock-icon.png           (1024×1024 source)
  dock-icon-squircle.png  (generated)
  icons/macos/            (generated)
```

---

## AI Generation Prompts

Use with DALL-E 3, GPT-4o image generation, or Midjourney.
Generate each strip separately. Maintain character consistency across generations.

### Character Description (include in every prompt)

```
CHARACTER: Pixel art robot. Bulky square-ish body, matte steel-grey with dark
panel lines. Large round LED eyes that glow cyan. Chest panel with a 4×3 grid
of indicator lights (mostly blue-green). Articulated metal fingers. Seated at a
clean minimalist white desk. A holographic display floats in front of the robot
(this is the screen/laptop equivalent). Background: bright white server room,
blue LED light strips along floor and ceiling, server rack on the right side.
Cool blue-white lighting throughout. Robot faces the viewer, fixed isometric view.
Pixel art style with clean outlines. Transparent background (RGBA PNG).
Character and desk are at the EXACT same angle in ALL frames.
Camera position NEVER moves between frames.
```

### sleeping-low-power.png — 1600×400 (4 frames × 400 px)

```
Pixel art sprite sheet strip. 4 frames. Each cell 400×400 pixels.
Total image: 1600×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — SLEEPING LOW POWER (loops):
Robot in deep sleep mode. Head drooped forward. LED eyes completely dark (off).
Chest indicator lights dimming in a slow pulse — most lights off in frames 1-2,
a faint few dim in frames 3-4, then back off. Arms resting flat on desk.
No other movement. Very slow, ambient, minimal.
```

### sleeping-standby.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — SLEEPING STANDBY (loops):
Robot in standby mode. Sitting fully upright (not slumped). LED eyes dark but with
a very faint pulse — dim glow in frames 3-4, fully dark in frames 1-2 and 5-6.
Chest indicators showing a slow horizontal scan: one row lighting faintly at a time,
cycling top-to-bottom across the 6 frames. No other movement. Looks paused, not broken.
```

### waking.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — WAKING (plays once):
Frame 1: Head drooped (low-power sleep), eyes dark, chest dim.
Frame 2: Head beginning to rise, chest lights activating one by one.
Frame 3: Eyes snap on with a bright cyan flash — the most vivid frame.
Frame 4: All chest indicators light simultaneously.
Frame 5: Sitting fully upright, holographic display activates.
Frame 6: Alert position, eyes glowing steadily cyan, fully operational.
```

### typing.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — TYPING (loops):
Robot typing on a holographic keyboard area below the display. Metal fingers moving
with mechanical precision — slight stagger creates a machine rhythm. Eyes scanning
back and forth across the display. Chest indicators active, showing processing
activity (lights cycling). Posture remains upright and still except the arms.
```

### alarmed.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — ALARMED (plays once):
Frame 1: Normal typing posture.
Frame 2: LED eyes flash to red. Typing stops.
Frame 3: A WARNING icon appears on the holographic display (pixel text "WARN").
Frame 4: Robot lurches back, arms beginning to raise.
Frame 5: Both arms raised to an alert position, chest panel flashing red.
Frame 6: Arms raised, eyes red, display showing a large warning symbol. Tense posture.
```

### celebrate.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — CELEBRATE (plays once):
Frame 1: Normal.
Frame 2: LED eyes shift to warm gold.
Frame 3: Chest panel opens to reveal a small fireworks pixel display.
Frame 4: One metal fist raised in the air.
Frame 5-6: Both arms raised, eyes gold, holographic display showing "DONE" with a
small star. The robot's face LED array approximates a smile (a curved row of lights).
```

### annoyed.png — 2400×400 (6 frames × 400 px)

```
Pixel art sprite sheet strip. 6 frames. Each cell 400×400 pixels.
Total image: 2400×400. No borders or labels between cells. Transparent background.

[CHARACTER DESCRIPTION above]

ANIMATION — ANNOYED (plays once):
Frame 1: Normal.
Frame 2: Eyes shift to orange-red. Display shows "ERR".
Frame 3: Display shows "ERROR" in pixel text.
Frame 4: Head shakes side to side (motion blur or two frames alternating left/right).
Frame 5: One metal palm pressed flat against the faceplate — a mechanical facepalm.
Frame 6: Head bowed forward, arms at sides, chest indicators showing a slow red pulse.
```

### borders.png — 2400×400 (6 frames × 400 px)

```
Pixel art animated border strip. 6 frames. Each frame: 400×400 pixels.
Total image: 2400×400. No borders or labels between cells.

The border is a picture-frame overlay the same size as the sprite (400×400 px).
The center is transparent so the sprite shows through underneath.
The opaque ring is ~12 px wide on each side — the sprite's rendered area is pushed
inward by this margin so the border doesn't clip. Adjust thickness to taste.

The border ring contains: dark angular mechanical frame (pixel art), with circuit-trace
engravings etched into the surface. At each corner: an angular bracket connector with
a small LED dot.

A bright cyan pulse dot travels clockwise around the ring — starts at the top-center
edge in frame 1, advances exactly 1/6 of the ring per frame, completing one full loop
by frame 6. Behind the pulse, the circuit traces glow faintly. The corner LEDs pulse
when the sweep passes them.

Hard pixel edges, no anti-aliasing. Mechanical, angular, precise.
```

### bg.png — 400×400 (static)

```
Pixel art background image. 400×400 pixels. Static (single frame).

Bright white server room. Blue LED light strips along the floor and ceiling edges.
Server rack on the right side with blinking status lights (pixel-art dots).
Clean, cool blue-white lighting. Floor has a subtle white tile grid.
No characters, no desk — background only.
```

### dock-icon.png — 1024×1024 (static)

```
Pixel art portrait icon. 1024×1024 pixels. The robot's head and upper chest only.
Centered on a dark charcoal background (#1a1a2e or similar).
Large round LED eyes glowing bright cyan. Matte steel-grey head with panel lines.
Chest indicator lights visible at the bottom. Faint blue ambient light.
Follow Apple icon spec: main content in ~824×824 center area with ~100 px margins.
No transparency — fill the full 1024×1024 with the background.
```

---

## Notes

- **Retina:** 400px native / density 2.0 = 200 CSS px on-screen. At @2x Retina, 200 CSS px
  = 400 physical pixels — the art maps 1:1 to physical pixels with no upscaling blur.
- **Border model:** border and sprite share the same window. The `margin` shrinks the sprite
  inward to make room for the border ring — the window stays the same size whether bordered
  or not. `margin: { x: 12, y: 12 }` (native px) → 6 CSS px inset on each side. The circuit
  sweep ring should be ~12 native px wide so it sits in that inset without clipping.
  Adjust the manifest value to match the actual art after generation.
- **`sleeping` multi-variant:** the player tracks "last played sleeping variant" and excludes
  it from the candidate set on the next sleep transition — same algorithm as reactions.
- `sleeping-low-power.png` is 4 frames at 2 fps — the slowest animation in any bundled pack.
- `corner_radius: 0` confirms the explicit-zero path — perfectly square, no OS rounding.
- Run `node scripts/generate-dock-icons.js` after placing `dock-icon.png`.
