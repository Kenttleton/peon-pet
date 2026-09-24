# peon-pet

A macOS desktop pet for [Peon-Ping](https://peonping.com) — an orc that reacts to your Claude Code events with sprite animations. Built on Electron + Three.js.

<video src="https://github.com/user-attachments/assets/7fd9a2cb-d227-49ad-8ccc-7953ec392a2d" autoplay loop muted playsinline width="400"></video>

Sits in the bottom-left corner of your screen, floats over all windows, and ignores mouse clicks (hover for tooltips).

## Requirements

- macOS (Linux/Windows untested)
- Node.js 18+
- [peon-ping](https://peonping.com) installed and running

## Quick start

```bash
git clone <repo> peon-pet
cd peon-pet
npm install
npm start
```

Check your dock for the app icon — right-click it for controls.

## CLI

The CLI is how you control the running app. Commands like `peon-pet scale 1.5` or `peon-pet packs use capybara` write to a config file that the app watches — changes appear on screen within about a second, no restart needed.

After `npm install`, link the CLI binary onto your PATH once:

```bash
npm link
```

Then `peon-pet` is available globally:

```
peon-pet packs list            # list available packs, * = active
peon-pet packs use capybara    # switch active pack (live, ~1 s)
peon-pet scale [value]         # get or set scale (positive number, live)
peon-pet border [on|off]       # get or set borders (live)
peon-pet corner [pos]          # get or set corner: bl, br, tl, tr (live)
peon-pet corner-radius [px]   # get or set window corner radius (live)
peon-pet remote [url]          # get or set peon-ping remote URL (live)
peon-pet status                # show current config
peon-pet status --verbose      # + config file path and LaunchAgent state
peon-pet install               # install as macOS LaunchAgent
peon-pet uninstall             # remove the LaunchAgent
```

Without `npm link`, prefix any command with `node bin/peon-pet.js` or `./node_modules/.bin/peon-pet`.

Running `peon-pet <setting>` with no argument prints the current value.

## Install permanently (auto-start at login)

First build the packaged app — this produces a real `Peon Pet.app` bundle so the dock shows "Peon Pet" rather than "Electron":

```bash
npm run build
```

Then install the LaunchAgent:

```bash
peon-pet install
```

This registers a macOS LaunchAgent pointing at the built `Peon Pet.app` binary so peon-pet starts at login, restarts if it quits, and appears in the dock as **Peon Pet**. Logs go to `/tmp/peon-pet.log`.

To remove:

```bash
peon-pet uninstall
```

> **Note:** `npm run build` is required before `peon-pet install`. If you skip it, `install` will exit with an error telling you to build first. After pulling updates you may want to rebuild before reinstalling so the LaunchAgent picks up any new bundled assets.

## Dock controls

Right-click the dock icon:

- **Hide Pet** / **Show Pet** — toggle visibility without quitting
- **Quit** — exit completely

## Animations

| Claude Code event | Animation |
|---|---|
| Session start / resume | Waking up (plays once) |
| Prompt submit | Typing |
| Task complete (Stop) | Celebrate |
| Permission request / context compact | Alarmed |
| Tool failure | Annoyed |

The orc stays in typing mode while any session is actively working (event within last 30 s). Returns to sleeping after 30 s of inactivity.

## Session dots

Up to 10 glowing orbs appear above the orc — one per tracked Claude Code session:

- **Bright pulsing green** — active (event within last 30 s)
- **Dim green** — idle (last event 30 s–2 min ago)

Sessions are removed when Claude Code fires `SessionEnd`, or automatically after 10 min of inactivity.

Hover over a dot to see the project folder and status. Hover anywhere on the widget to see all active project names.

## Dependencies

- **boolean**: Replaced with a local shim (`patches/boolean-shim`) via `overrides` so the deprecated `boolean` package is not installed. The shim matches the same API (`boolean`, `isBooleanable`).
- **glob / inflight**: These come from **Jest** (and related packages). Jest 29 still uses `glob@7`, which depends on deprecated `inflight`. You may see npm deprecation warnings; they are harmless. Upgrading to `glob@10` would require Jest to use the new API (see [jestjs/jest#15173](https://github.com/jestjs/jest/issues/15173), [#15910](https://github.com/jestjs/jest/issues/15910)). Until Jest updates, the warnings can be ignored or suppressed.

## Development

```bash
npm run dev    # starts with DevTools detached (dock shows "Electron" — expected in dev)
npm run build  # build Peon Pet.app to dist/mac-arm64/ for peon-pet install
npm test       # runs Jest test suite
```

Simulate an event by writing to the peon-ping state file:

```bash
python3 -c "
import json, time, os, uuid
f = os.path.expanduser('~/.claude/hooks/peon-ping/.state.json')
try: state = json.load(open(f))
except: state = {}
state['last_active'] = {
  'session_id': str(uuid.uuid4()),
  'timestamp': time.time(),
  'event': 'PermissionRequest'
}
json.dump(state, open(f, 'w'))
"
```

Valid events: `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUseFailure`, `PreCompact`

## Pets

Each pet is a **CEAP pack** — a directory with an `openpeon.json` manifest
describing its animations and assets (see [docs/ceap-spec.md](docs/ceap-spec.md)
for the full spec). peon-pet ships six bundled pets
(`renderer/assets/{orc,orc-tavern,capybara,hello-kitty,test-atlas,laptop-guy}/`);
`orc` is the default, and the only role it plays in another pet's
resolution is as the fallback for a missing `dock-icon` — categories,
`borders`, and `bg` never fall back across pets (see
[Fallback Behavior](docs/ceap-spec.md#fallback-behavior)): a pet that omits
one of those simply doesn't have it, rather than inheriting orc's.

### Switching pets

```bash
peon-pet packs list            # see what's available (* = active)
peon-pet packs use capybara    # switch — app updates live
```

For a one-shot override without changing the saved config:

```bash
npm run dev -- --pet capybara
```

An unrecognized or invalid name makes peon-pet exit with an error listing
the available bundled pets, rather than silently falling back to orc —
check the terminal output if the app doesn't appear to start.

**Upgrading from before CEAP:** if you had a custom character installed
under `~/Library/Application Support/Peon Pet/characters/`, peon-pet copies
it to `~/.openpeon/pets/` automatically on first launch after upgrading — no
action needed. That old `characters/` folder is no longer read afterward.

### Sizing and borders

Each pack declares its own on-screen size via `render_density` in its
manifest (see [docs/ceap-spec.md](docs/ceap-spec.md#render_density)) —
different categories can even render at different sizes on purpose (e.g. a
bigger, more dynamic `alarmed`). On top of that, you can scale everything:

```bash
peon-pet scale 1.5    # set persistently
peon-pet scale        # print current value
```

For a one-shot override without changing the saved config:

```bash
npm run dev -- --scale 1.5
```

`scale` is a positive number, default `1`; below `1` shrinks, above `1` grows.

Borders are opt-in, even for a pack that has one — peon-pet defaults to
full-bleed (no frame) unless you turn borders on:

```bash
peon-pet border on    # enable persistently
peon-pet border off   # disable
peon-pet border       # print current value
```

For a one-shot override:

```bash
npm run dev -- --border
```

`--border` only ever turns borders *on* — there's no `--no-border`, since
off is already the default. To disable a persistent `border on` for one
run, use `npm run dev` without `--border` after setting `peon-pet border off`.

### Building your own

A pack is entirely self-contained and lives in **your own**
`~/.openpeon/pets/<name>/` — there's no PR, no review, and nothing to merge
into this repo. The bundled set above is fixed; build and run a new one
locally instead.

```
~/.openpeon/pets/your-pet-name/
  openpeon.json         ← required: manifest
  sprite-atlas.png      ← your animation frames (name is your choice; must match openpeon.json)
  borders.png           ← optional: decorative frame overlay
  bg.png                ← optional: background texture
  dock-icon.png         ← optional: macOS dock icon
```

`openpeon.json`:

```json
{
  "ceap_version": "1.0",
  "name": "your-pet-name",
  "display_name": "Your Pet",
  "version": "1.0.0",
  "author": { "name": "Your Name", "github": "yourhandle" },
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

`sleeping` and `typing` are required — every pet must provide both. The
other four categories (`waking`, `alarmed`, `celebrate`, `annoyed`) are each
optional: omit one and that event simply has no visible effect, it's never
replaced by another animation (not orc's, not one of your own). `dock-icon`
falls back to orc's if you omit it; `borders` and `bg` do not — omit either
and your pet renders with no such layer at all. `name` must match
`^[a-z0-9][a-z0-9_-]{0,63}$`.

Each category's value is an **array** of one or more variants — almost
every pet needs only one, but you can list several to have the player pick
a different take each time (random, never repeating the same one twice in a
row). See [Variant selection](docs/ceap-spec.md#variant-selection) and
[`assets`](docs/ceap-spec.md#assets) in the spec for that, plus what else
`borders`/`bg`/`dock-icon` entries support (including animated borders/bg).

**`sprite-atlas.png`** — a single PNG sprite sheet with **6 columns × 6
rows** of animation frames (one file shared across all 6 categories,
differentiated by `row` in `openpeon.json` — or split into one file per
category if you prefer; `docs/ceap-spec.md` covers both). See
`docs/sprite-atlas-prompt.md` for the generation prompt used with image
models to make one like orc's.

| Spec | Value |
|---|---|
| Format | PNG, RGBA (transparent background) |
| Grid | 6 cols × 6 rows |
| Frame shape | Square — width must equal height |
| Style | Pixel art or illustrated; must be clearly readable at 200×200 px display size |

Row layout (fixed — do not reorder):

| Row | Category | Notes |
|---|---|---|
| 0 | `sleeping` | Loops. Pet at rest — all 6 frames should form a seamless idle loop. |
| 1 | `waking` | Plays once. Transition from asleep to alert. |
| 2 | `typing` | Loops while a session is active. Pet working at keyboard/desk. |
| 3 | `alarmed` | Plays 3× then returns. Reaction to permission requests / context limit. |
| 4 | `celebrate` | Plays 3× then returns. Reaction to task completion. |
| 5 | `annoyed` | Plays 3× then returns. Reaction to tool failures. |

Guidelines: all 6 frames per row must be present and non-blank; the
sleeping row should loop smoothly (frame 6 → frame 1 should not jump);
avoid copyrighted character likenesses without permission from the rights
holder.

**`borders.png`** (optional) — a PNG overlay drawn on top of the sprite,
matching the window size, transparent background except for the border
elements. No fallback: omit it and your pet renders with no border
overlay, not orc's.

**`bg.png`** (optional) — a PNG background texture drawn behind the
sprite. Not every pet needs one — some sprite art already has its own
background baked in. Omit it and your pet renders with no background
layer at all; it does **not** fall back to orc's.

**`dock-icon.png`** (optional) — a 512 × 512 px PNG shown in the macOS dock
when this pet is active, recognizable at small sizes (32–64 px). Defaults
to orc's dock icon if omitted.

### Window Corner

```bash
peon-pet corner br    # bottom-right
peon-pet corner       # print current value
```

Accepted values: `bl` (default), `br`, `tl`, `tr` — or the full names
`bottom-left`, `bottom-right`, `top-left`, `top-right`.
