# Contributing to peon-pet

This covers contributing to peon-pet's own code — the Electron app, the
renderer/player, and the CEAP resolution pipeline. If you're looking to
add or customize a *pet* (a CEAP pack), see [README.md](README.md#pets)
instead — that doesn't touch this repo at all.

## Project structure

| Path | What it is |
|---|---|
| `main.js` | Electron main process: window management, session tracking, CEAP pack resolution, the `peon-asset://` protocol handler, IPC. |
| `preload.js` | Bridges `lib/anim-state.js` and a few IPC channels into the renderer via `contextBridge` (the renderer runs with `contextIsolation: true`, so it can't `require()` anything itself). |
| `renderer/app.js` | The "player" — a Three.js scene that consumes the `peon-config`/`peon-event`/`session-update` IPC messages and draws the sprite, borders, background, session dots, and flash/particle effects. ES module, loaded by `renderer/index.html`. |
| `lib/*.js` | Pure, testable CommonJS modules: `ceap-manifest.js` (schema validation + pack resolution), `ceap-migration.js` (legacy pack migration), `anim-state.js` (UV math), `session-tracker.js`, `jsonl-watcher.js`, `window-position.js`. No Electron APIs — these all run under plain Jest. |
| `renderer/assets/<name>/` | Bundled CEAP packs (see `docs/ceap-spec.md`). This set is fixed; new pets go in `~/.openpeon/pets/`, not here. |
| `tests/` | One `*.test.js` file per `lib/*.js` module, plus `assets.test.js` for the bundled packs. |
| `docs/ceap-spec.md` | The CEAP pack format peon-pet reads. Read this before touching pack resolution, fallback behavior, or the manifest schema. |

## How the player works

1. On launch, `main.js` resolves the active pet — `~/.openpeon/pets/<name>/`
   if it exists and validates, else `renderer/assets/<name>/`, else an
   error (see `registerPetProtocol` in `main.js`). `lib/ceap-manifest.js`'s
   `resolvePack` does the actual merge: `dock-icon` falls back to the
   default (`orc`) pack; categories, `borders`, and `bg` never do.
2. Every resolved variant/asset gets an absolute filesystem path. `main.js`
   mints an opaque token per path and serves it through the custom
   `peon-asset://` protocol — deliberately *not* by encoding the real path
   into the URL (see the comment above `registerPetProtocol`: a
   `standard: true` scheme's host goes through Chromium's domain/IPv4
   parsing rules, which silently mangles both real paths and bare numeric
   tokens placed in the host position).
3. `main.js` sends the resolved pack over the `peon-config` IPC channel.
   `renderer/app.js`'s `initScene` builds the Three.js scene from it —
   scene setup can't happen at module load, since the pack data isn't
   known until this message arrives.
4. Claude Code hook events flow through `lib/jsonl-watcher.js` →
   `lib/session-tracker.js` → `main.js`'s `peon-event`/`session-update` IPC
   → `renderer/app.js`'s `playAnim`, which does CEAP's variant-selection
   (random, no-immediate-repeat) when a category has more than one
   variant.

## Development

```bash
npm run dev    # starts with DevTools detached
npm test       # runs the Jest suite
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

Switch pets while developing with `npm run dev -- --pet capybara` (see
[README.md](README.md#pets) for the full list).

## Conventions

- `main.js`, `preload.js`, and everything in `lib/` are CommonJS
  (`require`/`module.exports`), each starting with `'use strict'`.
  `renderer/app.js` is an ES module (`import`/native browser APIs) — it
  runs in the renderer, not Node, and has no access to `lib/` except what
  `preload.js` explicitly bridges through `contextBridge`.
- Every `lib/*.js` module is pure enough to unit-test without Electron —
  keep new logic there rather than in `main.js` or `renderer/app.js` when
  it doesn't need `main`'s Electron APIs or `app.js`'s Three.js scene.
- One test file per module, named `tests/<module>.test.js`. Run `npm test`
  before opening a PR — there's no CI configured yet, so this is the only
  gate.
- No bundler and no lint config — what you see in `node_modules`-free
  source is what ships. Keep new dependencies to a minimum.

## Submitting changes

Open a PR against `main`. Describe what changed and why, and confirm
`npm test` passes. For anything touching CEAP pack resolution or the
manifest schema, check the change against `docs/ceap-spec.md` first — the
spec is the source of truth; `main.js`/`lib/ceap-manifest.js` implement it,
they don't define it.
