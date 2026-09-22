# CEAP — Coding Event Animation Pack — v1.0

**Status:** Proposal, for review
**Companion to:** [CESP](https://openpeon.com/spec) (Coding Event Sound Pack), under the OpenPeon umbrella

## Overview

peon-pet's character visuals are currently hardcoded: a `BUNDLED_CHARS`
object in `main.js` maps a fixed list of filenames per character (`orc`,
`capybara`, `hello-kitty`), and the animation timing — which atlas row is
`typing`, how many frames, what fps — is duplicated as a hardcoded
`ANIM_CONFIG` object in both `lib/anim-state.js` and `renderer/app.js`.
Adding a new character means editing JavaScript in three places and matching
an undocumented 6×6 grid exactly.

CEAP defines a manifest format — modeled directly on CESP's proven design —
that makes a character pack self-describing: what animations it provides,
where the frames live, and how they're timed. peon-pet reads the manifest
instead of consulting a hardcoded map.

Where CESP packages sounds per event category, CEAP packages animations per
event category. **"Character"** is reserved as the umbrella term for a CEAP
pack optionally paired with a CESP pack (see [Future Work](#future-work)) —
not the name of this spec itself.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this
document are to be interpreted as described in RFC 2119.

Concretely reused from CESP's design:

- Manifest filename: **`openpeon.json`**, same as CESP — one filename works
  for both spec types, disambiguated by the `ceap_version` vs `cesp_version`
  key present in the file.
- Pack directory convention: `~/.openpeon/pets/<name>/`, mirroring CESP's
  `~/.openpeon/packs/<name>/`.
- Field naming conventions (`name`, `display_name`, `author`, `license`,
  `version`) copied as-is from CESP for consistency across the OpenPeon
  ecosystem.
- Multiple variants per category with no-immediate-repeat selection —
  CESP's `sounds: [...]` array plus its selection algorithm, ported
  directly. See [`categories`](#categories) and [Player
  Behavior](#player-behavior).

Deliberately **not** reused in v1.0 (see [Future Work](#future-work)):

- Registry integration (CESP packs are listed in `PeonPing/registry`; no
  equivalent exists for CEAP yet).
- Cross-referencing a CESP pack from a CEAP pack (a "Character" bundle).

## Terminology

Four words that have been used interchangeably up to now, disambiguated
going forward:

| Term | Meaning |
|---|---|
| **Pet** | Product-level term for the on-screen Electron app/entity. The app is "Peon Pet." |
| **Character** | A selectable identity for the pet (orc, capybara, hello-kitty, ...). Matches the existing `--character` flag, `char` variable, and `characters/` directory in `main.js`. In the OpenPeon umbrella sense, also the term for a CEAP+CESP bundle (see [Future Work](#future-work)). |
| **CEAP pack** | The installable/distributable unit this spec defines: a directory with an `openpeon.json` manifest plus its animation and asset files. One character is backed by one CEAP pack. |
| **Animation** | A named category of movement (`sleeping`, `typing`, ...) and the frame data behind it — the thing CEAP's `categories` field describes. |
| **Sprite** | The pixel-art image asset format itself (a strip or atlas PNG). An implementation detail of how an animation's frames are stored on disk — not a pack-level noun. |

## Event Categories

The six fixed categories split into two kinds:

- **Steady states** — `sleeping` and `typing`. Exactly one of these is
  showing whenever no reaction is playing; the player rests in one or the
  other for as long as a session stays idle or active. A pack that
  declares `categories` at all MUST provide both.
- **Reactions** — `waking`, `alarmed`, `celebrate`, `annoyed`. Transient:
  each plays once (or `loops` times), then control returns to whichever
  steady state applies. Each is optional; see [Fallback
  Behavior](#fallback-behavior) for what happens when a pack omits one.

| Category | Kind | Meaning |
|---|---|---|
| `sleeping` | Steady state, **required** | Idle state. Loops indefinitely while nothing is active. |
| `typing` | Steady state, **required** | A session is actively working. Loops for as long as it stays active. |
| `waking` | Reaction, optional | Transition out of `sleeping` when a session starts. |
| `alarmed` | Reaction, optional | A session needs input (permission request, context compaction). |
| `celebrate` | Reaction, optional | A session finished its task. |
| `annoyed` | Reaction, optional | A tool call failed. |

This set matches `EVENT_TO_ANIM` in `lib/session-tracker.js` exactly — see
[Event Mapping](#event-mapping).

## Manifest Format

The manifest MUST be a file named `openpeon.json` at the root of the pack
directory.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `ceap_version` | string | Spec version. MUST be `"1.0"` for this document. |
| `name` | string | Machine-readable id. MUST match `^[a-z0-9][a-z0-9_-]{0,63}$` (the same pattern CESP's registry schema uses for sound packs). |
| `display_name` | string | Human-readable name, 1–128 characters. |
| `version` | string | The pack's own semantic version (e.g. `"1.0.0"`), independent of `ceap_version`. |

A manifest MUST declare at least one of `categories` or `assets` — a pack
MAY consist entirely of asset overrides (e.g. a borders-only cosmetic pack)
with no `categories` block at all.

### Recommended Fields

| Field | Type | Description |
|---|---|---|
| `author` | object | `{ name?: string, github?: string }`. |
| `license` | string | SPDX identifier or free text. |

### `categories`

An object keyed by category name (see [Event Categories](#event-categories)
— a validator MUST reject unknown keys). If `categories` is present, it
MUST include both `sleeping` and `typing` — a validator MUST reject a
`categories` block that omits either of the two steady states. Each value
is a **non-empty array** of one or more variants — the same shape as
CESP's `sounds: [...]` array. Most categories will declare exactly one
variant; an array with more than one lets a pack offer several takes on
the same animation, selected at random with no-immediate-repeat (see
[Player Behavior](#player-behavior)):

```json
"typing": [
  { "file": "sprite-atlas.png", "row": 2, "rows": 6, "frames": 6, "fps": 8 }
]
```

```json
"typing": [
  { "file": "typing-focused.png", "frames": 6, "fps": 8, "label": "focused" },
  { "file": "typing-frantic.png", "frames": 6, "fps": 10, "label": "frantic" }
]
```

| Field | Required | Default | Description |
|---|---|---|---|
| `file` | yes | — | Path to the sprite sheet, relative to the pack directory. |
| `row` | no | `0` | Which row of `file`'s grid this variant occupies. |
| `rows` | no | `1` | Total row count in `file`'s grid. Authors doing one-file-per-variant omit this (the default of `1` is correct). Authors sharing a single atlas across variants/categories MUST set it explicitly on every entry that references that file, and every entry sharing a `file` value — across all categories and all variants — MUST declare the same `rows`; a validator MUST reject a mismatch at load time. |
| `frames` | yes | — | Column count / frame count in this row. |
| `fps` | yes | — | Playback speed, in frames per second. |
| `loop` | no | `false` | Whether the animation repeats indefinitely. Only `sleeping` SHOULD set this `true`. |
| `loops` | no | player default | Only meaningful when `loop` is `false`: how many times to play before the player returns to `sleeping` (or `typing`, if a session is still active). |
| `label` | no | — | Free-text note identifying this variant to the author (e.g. in a review UI). Not shown to end users. |

Both authoring styles are supported by the same schema:
- **One atlas, many rows:** every variant's `file` points at the same
  image, differentiated by `row` + `rows`.
- **One file per variant:** every variant's `file` is a distinct
  single-row strip; `row` and `rows` are omitted (their defaults handle it).

### `assets`

An object keyed by a fixed set of asset roles — the same three overlay
files a bundled character maps today:

```json
"assets": {
  "dock-icon": { "file": "dock-icon.png" },
  "borders":   { "file": "borders.png" },
  "bg":        { "file": "bg.png" }
}
```

| Key | Description |
|---|---|
| `dock-icon` | macOS dock icon while this character is active. MUST be static — see below. |
| `borders` | Decorative overlay drawn on top of the sprite. MAY be static or animated. |
| `bg` | Background texture drawn behind the sprite. MAY be static or animated. |

`borders` and `bg` MAY be **animated**: a continuous, ambient effect (a
lightning crackle, a shimmering glow) that loops independently of the
character's own state — it is not tied to `sleeping`/`typing`/any reaction,
and does not participate in [variant selection](#variant-selection) (an
animated asset is a single strip, not an array). An asset entry becomes
animated by adding the same frame-timing fields a category variant uses:

```json
"borders": { "file": "borders-lightning.png", "frames": 8, "fps": 12, "loop": true }
```

| Field | Required | Default | Description |
|---|---|---|---|
| `file` | yes | — | Path to the image, relative to the pack directory. |
| `frames` | no | `1` | Frame count. `1` (the default) means static — the fields below are meaningless and MUST be omitted when `frames` is absent or `1`. |
| `fps` | required if `frames` > 1 | — | Playback speed, in frames per second. |
| `row` / `rows` | no | `0` / `1` | Same meaning as a category variant's `row`/`rows`, for authors sharing an atlas between an animated asset and something else. |
| `loop` | no | `true` | Animated assets default to looping, since there's no event to return from — this is ambient, not a reaction. |

`dock-icon` MUST NOT declare `frames` > 1 — a validator MUST reject it. A
macOS dock icon has no animation mechanism to drive; players render frame 0
only, so allowing the field would silently mislead an author into thinking
it will animate.

A pack MAY declare only the asset keys it overrides.

## Directory Structure

```
~/.openpeon/pets/<name>/
  openpeon.json
  sprite-atlas.png       (or one file per category — author's choice)
  borders.png            (optional)
  bg.png                 (optional)
  dock-icon.png          (optional)
```

- The manifest filename MUST be `openpeon.json`, disambiguated from a CESP
  manifest by the presence of `ceap_version` rather than `cesp_version`.
- User-installed packs live at `~/.openpeon/pets/<name>/` — the real home
  directory, not an app-specific data directory — mirroring CESP's
  `~/.openpeon/packs/<name>/`.
- **Bundled defaults:** `orc`, `capybara`, and `hello-kitty` ship inside the
  app package (under `renderer/assets/<name>/`), each with its own
  `openpeon.json`, replacing today's hardcoded `BUNDLED_CHARS` object.
  `orc` remains the default pack for [asset
  fallback](#asset-fallback) — for `dock-icon` only; categories don't have
  a cross-pack default at all, see [Category
  fallback](#category-fallback). This is a v1.0-only choice: CESP's own
  defaults are *not* bundled files but an install-time download (see
  [Future Work](#future-work) for the planned convergence once CEAP packs
  are registry-listed).
- **Migration:** on first launch after this change, if `~/.openpeon/pets/`
  doesn't exist but the legacy `<userData>/characters/` directory (today's
  install location, documented in `CONTRIBUTING.md`) does, peon-pet copies
  existing custom character folders over once, synthesizing an
  `openpeon.json` for them from the legacy `character.json` format. No user
  action required; the legacy path is not written to going forward.

## Fallback Behavior

Categories and assets fall back differently, and the three asset keys
don't all fall back the same way either. `dock-icon` falls back *to the
default pack* — the app always needs some icon to show in the dock, so a
pack that omits one still gets orc's. `borders` and `bg` have **no
fallback**: they're cosmetic chrome a pack may simply not use — not every
sprite needs a background layer, and a pack's own border style shouldn't
be replaced by another pack's (an orc medieval border standing in for a
hello-kitty pack that has none would look wrong). A pack that omits
`borders` or `bg` renders without that layer, full stop. See [Asset
fallback](#asset-fallback) below for the resolution order per key.

Categories never fall back to a substitute animation at all, from this
pack or any other — a pack's visual identity should never be a patchwork
of another character's animations, or of its own animations standing in
for each other. See [Category fallback](#category-fallback) below for what
a missing reaction category does instead.

### Category fallback

Both steady states (`sleeping`, `typing`) are required whenever `categories`
is present, so there's never a missing-steady-state case to resolve. The
four reaction categories (`waking`, `alarmed`, `celebrate`, `annoyed`) are
each optional, and a missing one is **not** resolved by substituting any
animation — from this pack or another:

- A player MUST NOT play another pack's animation for a category the
  active pack omits.
- A player MUST NOT substitute a different animation from the *same* pack
  either (in particular, `sleeping` is not a stand-in for a missing
  `waking`, `alarmed`, `celebrate`, or `annoyed` — playing "asleep" to
  represent "waking up," for instance, would show the opposite of what
  happened).
- Instead, when the active pack omits a reaction category, the
  corresponding event simply has no visible effect: the player continues
  showing whichever steady state already applies (`typing` if a session is
  active, `sleeping` otherwise), exactly as if the event had fired with no
  category mapped to it at all.

For clarity: a pack that declares only `sleeping` and `typing` shows no
special reaction to a task completing, a permission request, or a tool
failure — the character just keeps typing (or returns to sleeping once the
session goes idle).

The entry used for a category that *is* present is the whole variant array
— a category's variants are never merged with another category's. Which
single variant plays on a given transition is a separate, later decision —
see [Player Behavior](#player-behavior).

### Asset fallback

A pack is not required to provide every asset, and resolution differs by
key:

- **`dock-icon`** — falls back to the default pack, at load time:
  1. The active pack's own manifest entry, if present.
  2. The default pack's (`orc`) manifest entry.
- **`borders` / `bg`** — no fallback. If the active pack's manifest omits
  the key, the player renders without that layer entirely; it never
  substitutes the default pack's (or any other pack's) asset. See the
  `capybara`/`hello-kitty` examples below, both of which omit `bg` and
  render with no background layer at all.

This narrows today's `charMap[filename] || BUNDLED_CHARS.orc[filename] ||
filename` fallback chain in `main.js`, which applies that same fallback to
every filename uniformly — CEAP keeps it for `dock-icon` only. The default
pack MUST provide a `dock-icon`, since that's the one key every other pack
can lean on; its own `borders`/`bg` are for its own rendering, not a
fallback contract.

## Animation Constraints

| Constraint | Value |
|---|---|
| Format | PNG |
| Transparency | RGBA recommended for anything layered over other art (sprite, borders) |
| Frame shape | SHOULD be square, for consistent scaling, but this is not validated |

A validator MUST reject a manifest whose `row` is not less than its `rows`,
and MUST reject a `frames` or `fps` that is not a positive number.

## Event Mapping

Player applications map their own event vocabulary onto CEAP's fixed
categories. peon-pet's mapping (`lib/session-tracker.js`):

| Claude Code event | CEAP category |
|---|---|
| `SessionStart` | `waking` |
| `UserPromptSubmit` | `typing` |
| `Stop` | `celebrate` |
| `PermissionRequest` | `alarmed` |
| `PreCompact` | `alarmed` |
| `PostToolUseFailure` | `annoyed` |

## Player Behavior

- A player MUST NOT switch into `waking` except from `sleeping` — a session
  starting while the character is already awake SHOULD be ignored.
- A player MUST play a non-looping category's frames once, then repeat them
  `loops` times (player-chosen default, e.g. 3) before returning to
  `sleeping`, or to `typing` if a session is still active by the time the
  reaction finishes.
- A player SHOULD return to `sleeping` after a period of inactivity
  (peon-pet: 30 seconds) with no active session.
- A player MUST resolve asset fallback per-asset key independently, per
  [Asset fallback](#asset-fallback) — a partial pack MUST NOT be rejected
  outright. For `borders`/`bg` this means rendering with no such layer at
  all when the active pack omits it, not substituting another pack's.
- A player MUST NOT play any substitute animation for a reaction category
  the active pack omits — per [Category fallback](#category-fallback), the
  event that would have triggered it simply has no visible effect.
- A player MUST advance an animated `borders`/`bg` asset on its own frame
  timer, independent of the sprite's current category — an ambient effect
  keeps playing through `sleeping`, `typing`, and every reaction without
  regard to what the sprite is doing.

### Variant selection

Every transition into a category picks exactly one variant from that
category's resolved array, using CESP's own selection algorithm (ported
directly, `peon.sh`):

1. If the category has exactly one variant, use it.
2. Otherwise, the candidate set is every variant **except** the one played
   last time this category was entered (tracked in memory, per category,
   since the player started — not persisted across restarts).
3. Pick uniformly at random among the candidates.
4. Remember the picked variant as "last played" for that category, for the
   next time step 2 runs.

A player MUST apply this algorithm to every category with more than one
variant, and MUST NOT play the same variant twice in a row for a category
that has an alternative available.

## Worked Examples

These show CEAP applied to peon-pet's three actual bundled characters,
reorganized from today's flat `renderer/assets/*.png` files into per-pack
directories. Dimensions are the real files in this repo today.

### `orc` (default pack)

Source atlas: `orc-sprite-atlas.png`, 4096×4096 — a 6×6 grid, one file
shared across all 6 categories.

```
renderer/assets/orc/
  openpeon.json
  sprite-atlas.png   (today's orc-sprite-atlas.png, 4096x4096)
  borders.png        (today's orc-borders.png)
  bg.png             (today's bg-pixel.png)
  dock-icon.png       (today's orc-dock-icon.png)
```

```json
{
  "ceap_version": "1.0",
  "name": "orc",
  "display_name": "Orc",
  "version": "1.0.0",
  "license": "CC-BY-NC-4.0",
  "categories": {
    "sleeping":  [{ "file": "sprite-atlas.png", "row": 0, "rows": 6, "frames": 6, "fps": 3, "loop": true }],
    "waking":    [{ "file": "sprite-atlas.png", "row": 1, "rows": 6, "frames": 6, "fps": 2, "loop": false, "loops": 1 }],
    "typing":    [{ "file": "sprite-atlas.png", "row": 2, "rows": 6, "frames": 6, "fps": 8 }],
    "alarmed":   [{ "file": "sprite-atlas.png", "row": 3, "rows": 6, "frames": 6, "fps": 8 }],
    "celebrate": [{ "file": "sprite-atlas.png", "row": 4, "rows": 6, "frames": 6, "fps": 8 }],
    "annoyed":   [{ "file": "sprite-atlas.png", "row": 5, "rows": 6, "frames": 6, "fps": 8 }]
  },
  "assets": {
    "dock-icon": { "file": "dock-icon.png" },
    "borders":   { "file": "borders.png" },
    "bg":        { "file": "bg.png" }
  }
}
```

The `fps`/`loop`/`loops` values above are copied verbatim from today's
hardcoded `ANIM_CONFIG` in `renderer/app.js` — this manifest is a lossless
description of orc's current behavior, not a change to it. Every category
here has exactly one variant, since that's all today's assets provide —
[variant selection](#variant-selection) is a no-op until a pack actually
supplies alternatives (see the split-files example below).

### `capybara` (partial pack — no `bg`)

Source atlas: `capybara-sprite-atlas.png`, 2048×2048 — also a 6×6 grid.
`BUNDLED_CHARS.capybara` has no `bg.png` entry today; under CEAP that
means capybara simply renders with no background layer, per [Asset
fallback](#asset-fallback) — not orc's `bg-pixel.png` standing in.

```
renderer/assets/capybara/
  openpeon.json
  sprite-atlas.png   (today's capybara-sprite-atlas.png, 2048x2048)
  borders.png        (today's capybara-borders.png)
  dock-icon.png       (today's capybara-dock-icon.png)
```

```json
{
  "ceap_version": "1.0",
  "name": "capybara",
  "display_name": "Capybara",
  "version": "1.0.0",
  "categories": {
    "sleeping":  [{ "file": "sprite-atlas.png", "row": 0, "rows": 6, "frames": 6, "fps": 3, "loop": true }],
    "waking":    [{ "file": "sprite-atlas.png", "row": 1, "rows": 6, "frames": 6, "fps": 2, "loop": false, "loops": 1 }],
    "typing":    [{ "file": "sprite-atlas.png", "row": 2, "rows": 6, "frames": 6, "fps": 8 }],
    "alarmed":   [{ "file": "sprite-atlas.png", "row": 3, "rows": 6, "frames": 6, "fps": 8 }],
    "celebrate": [{ "file": "sprite-atlas.png", "row": 4, "rows": 6, "frames": 6, "fps": 8 }],
    "annoyed":   [{ "file": "sprite-atlas.png", "row": 5, "rows": 6, "frames": 6, "fps": 8 }]
  },
  "assets": {
    "dock-icon": { "file": "dock-icon.png" },
    "borders":   { "file": "borders.png" }
  }
}
```

Note `author`/`license` are omitted — this proposal makes no claim about
authorship or license terms for a pre-existing bundled asset it didn't
create; a real submission would fill these in per
[CONTRIBUTING.md](../CONTRIBUTING.md).

### `hello-kitty` (same shape as capybara)

Source atlas: `hello-kitty-sprite-atlas.png`, 2048×2048 — same 6×6 grid,
same partial-pack shape (no `bg`, so no background layer at all — not
orc's):

```
renderer/assets/hello-kitty/
  openpeon.json
  sprite-atlas.png   (today's hello-kitty-sprite-atlas.png, 2048x2048)
  borders.png        (today's hello-kitty-borders.png)
  dock-icon.png       (today's hello-kitty-dock-icon.png)
```

```json
{
  "ceap_version": "1.0",
  "name": "hello-kitty",
  "display_name": "Hello Kitty",
  "version": "1.0.0",
  "categories": {
    "sleeping":  [{ "file": "sprite-atlas.png", "row": 0, "rows": 6, "frames": 6, "fps": 3, "loop": true }],
    "waking":    [{ "file": "sprite-atlas.png", "row": 1, "rows": 6, "frames": 6, "fps": 2, "loop": false, "loops": 1 }],
    "typing":    [{ "file": "sprite-atlas.png", "row": 2, "rows": 6, "frames": 6, "fps": 8 }],
    "alarmed":   [{ "file": "sprite-atlas.png", "row": 3, "rows": 6, "frames": 6, "fps": 8 }],
    "celebrate": [{ "file": "sprite-atlas.png", "row": 4, "rows": 6, "frames": 6, "fps": 8 }],
    "annoyed":   [{ "file": "sprite-atlas.png", "row": 5, "rows": 6, "frames": 6, "fps": 8 }]
  },
  "assets": {
    "dock-icon": { "file": "dock-icon.png" },
    "borders":   { "file": "borders.png" }
  }
}
```

### A hypothetical multi-variant, split-files pack

To illustrate the two remaining degrees of freedom the schema allows —
no shared atlas (`row`/`rows` omitted entirely) and more than one variant
per category — none of today's bundled characters exercise either, so
this one is illustrative rather than drawn from a real asset:

```json
{
  "ceap_version": "1.0",
  "name": "example-split-files",
  "display_name": "Example (split files)",
  "version": "1.0.0",
  "categories": {
    "sleeping": [
      { "file": "sleeping.png", "frames": 4, "fps": 2, "loop": true }
    ],
    "typing": [
      { "file": "typing-focused.png", "frames": 8, "fps": 10, "label": "focused" },
      { "file": "typing-frantic.png", "frames": 8, "fps": 14, "label": "frantic" }
    ]
  },
  "assets": {
    "borders": { "file": "frame.png" }
  }
}
```

`sleeping.png`, `typing-focused.png`, and `typing-frantic.png` are each a
single-row strip; `row` and `rows` default to `0` and `1`, which is exactly
what a single-row file needs. `typing` has two variants: per [Variant
selection](#variant-selection), the first time a session starts typing the
player picks one of the two at random; if the character goes back to
`typing` again later without an intervening restart, it MUST pick the
other one (there are only two candidates, and the last-played one is
excluded).

This pack also demonstrates the minimum valid `categories` block — just
the two required steady states, no reactions at all. Per [Category
fallback](#category-fallback), a session starting, a permission request, a
task completing, or a tool failure all produce no special animation here;
the character only ever shows `sleeping` or `typing`.

### A hypothetical animated border

To illustrate the ambient asset animation from the [`assets`](#assets)
section — a lightning-crackle effect running continuously around the
sprite, independent of whatever the character itself is doing:

```json
{
  "ceap_version": "1.0",
  "name": "orc",
  "display_name": "Orc",
  "version": "1.1.0",
  "categories": { "...": "unchanged from the earlier orc example" },
  "assets": {
    "dock-icon": { "file": "dock-icon.png" },
    "borders":   { "file": "borders-lightning.png", "frames": 8, "fps": 12, "loop": true },
    "bg":        { "file": "bg.png" }
  }
}
```

`borders-lightning.png` is an 8-frame strip; the player loops it at 12fps
forever, in parallel with the sprite's own `sleeping`/`typing`/reaction
frame timer — the two are unrelated. Compare to `dock-icon`, which stays a
plain `{ "file": "dock-icon.png" }` with no frame fields, since it's
required to be static.

## Implementation Notes

Flagged here for the reviewer's benefit — these affect effort estimation
for adopting this spec, not the schema itself:

- **Renderer texture loading changes.** `renderer/app.js` currently loads
  exactly one texture (`peon-asset://sprite-atlas.png`). Because categories
  (and now variants within a category) can each point at a different file,
  the renderer needs to load and cache textures keyed by filename — one
  per distinct file a pack declares, not a fixed count — and swap
  `material.map` on animation switch, recomputing UVs from that file's own
  `frames`/`rows` rather than the current global
  `ATLAS_COLS`/`ATLAS_ROWS` constants.
- **Single source of truth for animation config.** `lib/anim-state.js`
  (currently dead code outside tests) becomes the actual shared module for
  UV math, replacing the duplicated inline `ANIM_CONFIG` in
  `renderer/app.js`. It should be parameterized by the resolved manifest
  data instead of a hardcoded object. Note: `renderer/app.js` runs with
  `contextIsolation: true, nodeIntegration: false`, so it cannot `require()`
  a CommonJS module directly — sharing it means exposing it through
  `preload.js`'s `contextBridge`, the same mechanism already used for IPC.
- **`main.js` protocol handler.** `registerCharacterProtocol` keeps its job
  (resolve a requested filename to an absolute path, custom-pack dir first,
  then bundled), but the filename→path map it consults comes from parsing
  the active pack's (and default pack's) `openpeon.json` instead of the
  `BUNDLED_CHARS` literal.
- **Variant selection state.** The "last played" tracking [Player
  Behavior](#player-behavior) requires is new: nothing today tracks
  per-category history, since every category currently resolves to exactly
  one animation. This is small (one map, category name → last-picked
  index, held for the process lifetime) but it's a new piece of runtime
  state, not just a manifest-parsing change.
- **Migration.** A pre-CEAP custom character folder (`character.json`, no
  `openpeon.json`) has no manifest to resolve against — a straight file
  copy to `~/.openpeon/pets/` would leave it invisible under CEAP's
  resolution rules, since CEAP has no filename-existence fallback the way
  today's code does. Migration needs to synthesize an `openpeon.json` for
  each copied legacy folder, applying the fixed 6×6 row layout
  `CONTRIBUTING.md` already documents for `character.json`-based
  submissions.
- **Animated border/bg rendering.** `borderMesh`/`bgMesh` in
  `renderer/app.js` are currently a single static texture each. An
  animated asset needs its own frame timer and its own UV update on the
  same mesh — the same `computeUVs`/texture-cache machinery the sprite
  uses, just a second independent instance running on its own clock,
  decoupled from `currentAnim`.

## Future Work

Captured now as intent, not designed in detail — each of these needs its
own follow-on brainstorm before implementation:

1. **Event-linked border animation.** Let a border effect vary by category
   — a red pulse during `alarmed`, a gold shimmer during `celebrate` —
   instead of one continuous ambient effect. This needs its own resolution
   design (a `border_categories` block mirroring `categories`? a per-category
   `border` override?) and its own fallback semantics, and should get the
   same scrutiny [Category fallback](#category-fallback) got rather than
   reusing it by assumption.
2. **`bundled_sound_pack` field.** An optional manifest field naming a CESP
   pack (by its existing registry `name`) that pairs with this character by
   default, so an install flow can offer "install the matching sounds too."
   Manifest-only; requires no registry change.
3. **Registry integration.** A shared OpenPeon registry listing sound packs,
   character (CEAP) packs, and CEAP+CESP bundles together, with pets
   discoverable under a `pets/` path convention parallel to sound packs'
   `sounds/`. The current `PeonPing/registry` schema
   (`registry-v1.schema.json`) has no way to say a `source_repo` provides
   sound, animation, or both, and `additionalProperties: false` everywhere
   means it can't just grow a field.

   A `registry-v2` proposal against that repo (separate governance,
   separate design, not peon-pet's to decide unilaterally) should avoid a
   `type: "sound" | "animation" | "both"` discriminator — that's a second
   place to keep in sync with what the repo actually contains, and it's
   redundant with the fields already needed either way. Cleaner: nest the
   format-specific fields (CESP's `categories`/`sound_count`, CEAP's own
   category list) under two independently-optional sub-objects, `sound` and
   `animation`, each with its own `source_path`/`manifest_sha256` pointing
   at that format's `openpeon.json` within the repo (they disambiguate via
   `cesp_version`/`ceap_version` same as always, and MAY live at different
   paths in one repo). A pack entry's capabilities are then implicit in
   which of the two sub-objects is present — a sound-only pack omits
   `animation`, an animation-only pack omits `sound`, and a full Character
   bundle (see [Terminology](#terminology)) has both, all without a
   separate flag that could drift from reality:

   ```json
   {
     "name": "capybara",
     "display_name": "Capybara",
     "version": "1.0.0",
     "trust_tier": "community",
     "source_repo": "someone/peonping-capybara",
     "source_ref": "v1.0.0",
     "sound": {
       "categories": ["session.start", "task.complete"],
       "sound_count": 12,
       "source_path": "sounds/",
       "manifest_sha256": "..."
     },
     "animation": {
       "categories": ["sleeping", "typing", "waking", "celebrate"],
       "source_path": "pets/",
       "manifest_sha256": "..."
     }
   }
   ```

   The schema (`registry-v1.schema.json`) is only one of three places that
   would need this split — inspecting `PeonPing/registry` directly shows
   the other two:

   - `.github/workflows/validate-index.yml` hardcodes its own
     `REQUIRED_FIELDS` list (`name`, `display_name`, `version`,
     `trust_tier`, `categories`, `language`, `sound_count`, `source_repo`,
     `source_ref`, `source_path`) as flat, unconditional per-pack
     requirements, duplicating the schema rather than reading it, and
     already drifts from it (`source_path` is required here but not in the
     schema). This would need to become "require `sound` or `animation`,
     and validate each sub-object's own required fields only when that
     sub-object is present" instead of one flat list.
   - `backfill-quality.yml` downloads each changed pack's tarball straight
     from `source_repo`@`source_ref`/`source_path` and runs
     `.github/scripts/quality-check.py` against the extracted files to set
     the CI-owned `quality` tier. That script is audio-specific — an
     analogous animation quality check (frame-count/dimension consistency,
     transparency, square frames) would be new work, not a schema change,
     and the workflow would need to dispatch to the right checker per
     sub-object rather than assuming every pack is sound.

   None of this is peon-pet's call to make — it belongs in a `registry-v2`
   proposal against `PeonPing/registry` itself — but the path forward is
   concrete enough to scope: a schema change, a validation-workflow change,
   and a new quality-check script, not just "add a field."

4. **Move bundled defaults to install-time download, mirroring CESP.**
   Today's `BUNDLED_CHARS`, and this spec's replacement (`orc`/`capybara`/
   `hello-kitty` shipped as files under `renderer/assets/<name>/`), ship
   with the app binary. CESP does not do this for its own defaults: `peon-
   ping`'s `install.sh` hardcodes `DEFAULT_PACKS="peon peasant sc_scv
   sc_battlecruiser glados"` — five pack *names*, not files — and at
   install time hands that list to `pack-download.sh`, which resolves each
   name against `REGISTRY_URL` (`peonping.github.io/registry/index.json`),
   falling back to a pinned `FALLBACK_REPO="PeonPing/og-packs"` at
   `FALLBACK_REF="v1.1.0"` if the registry is unreachable, downloads each
   pack's files individually, and caches them by sha256 checksum
   (`is_cached_valid`/`store_checksum`) so re-installs and updates only
   re-fetch what changed.

   This can't happen before item 3 above lands — there is no registry
   entry to resolve `orc`/`capybara`/`hello-kitty` against yet — but once
   CEAP packs are listed (a `pets/` source_path per pack entry, per the
   `registry-v2` sketch), peon-pet's own install/first-run path should
   converge on the same shape: a `DEFAULT_PETS`-style hardcoded name list
   in place of today's literal `renderer/assets/` bundling, a pet-specific
   analog of `pack-download.sh` (or an extension of it) that resolves
   names against the registry with a pinned fallback repo/ref for
   offline/unreachable-registry installs, and the same per-file checksum
   cache. `orc` likely stays special-cased as the one pet guaranteed
   present with no download step, since it backs [asset
   fallback](#asset-fallback) and the app needs *something* to render
   before any network call succeeds — everything else (including
   `capybara`/`hello-kitty`) would move to the download path CESP already
   proves out.

## Out of Scope

- The `main.js`/`package.json` version bumps (electron/three/canvas/jest)
  and the `peon-asset://` scheme's `corsEnabled: true` fix — already
  written, uncommitted, shipping as their own unrelated PR.
