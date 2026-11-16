# Renderer Rewrite — Full Feature Test Plan

**Goal:** Exercise every pre-existing peon-pet feature against the new PixiJS-based renderer architecture, to catch anything the Three.js → PixiJS rewrite broke beyond what's already been found and fixed (sprite rendering, border/bg textures, canvas sizing, sprite repositioning, CSP/eval issues).

**How to use this doc:** Work through each section in order. Each step has a concrete action and an expected outcome. Check a step off only after confirming the expected outcome — if something doesn't match, stop and report it (don't just note it and move on, since a later step may depend on this one being correct). `?debug=1`-style console logging (added in this session) is available for every renderer window via DevTools (`Cmd+Option+I` in a `--dev` launch) — open it before starting Section 2 onward and leave it open throughout; the `[peon-pet:*]` log lines will show you the actual event flow for every step below, which is the fastest way to confirm *why* something did or didn't happen.

**Before starting:** Kill any stale `peon-pet` Electron process (`pkill -f "Electron.*peon-pet"` or check Activity Monitor) to guarantee a clean start — a stale process was the root cause of one bug already found this session.

```bash
npm run build:renderer   # rebuild the bundle fresh
npm test                 # confirm the full suite is green before manual testing
```

---

## Section 0: Baseline sanity

- [ ] **0.1** — Run `node bin/peon-pet.js status` (no app running). Expected: prints `pack`/`dir`/`scale`/`border`/`corner`/`radius`/`remote` with no error (this was broken before today's fix — confirm it's fixed).
- [ ] **0.2** — Run `node bin/peon-pet.js status --verbose`. Expected: additionally prints `config:` (a real file path) and `service: not installed` (unless you've run `peon-pet install` before).
- [ ] **0.3** — Run `npm run dev`. Expected: the pet window opens, renders the currently-configured pack's sleeping animation, no console errors. Open DevTools (should auto-open in `--dev` mode) and confirm no red errors in the Console tab.

---

## Section 1: CEAP pack system

Switch through every bundled pack and confirm each renders distinctly. Use `node bin/peon-pet.js packs use <name>` while the app is running — this should hot-swap with **no restart**.

- [ ] **1.1 — `orc` (baseline, has border, no bg, 6 categories, density 3.4)**
  `node bin/peon-pet.js packs use orc`
  Expected: pet updates within ~1s to the orc sprite; wooden bordered frame with corner brackets appears; dock icon changes to the orc icon (macOS).

- [ ] **1.2 — `hello-kitty` (has border, pink dot colors, density 1.7)**
  `node bin/peon-pet.js packs use hello-kitty`
  Expected: sprite changes, border frame changes style, dock icon changes. Trigger a session dot (see Section 3) and confirm it renders pink (`rgba(255,105,180,...)`), not the default green.

- [ ] **1.3 — `capybara` (has border, amber dot colors, density 1.7)**
  `node bin/peon-pet.js packs use capybara`
  Expected: sprite/border/icon change; dots render amber.

- [ ] **1.4 — `orc-tavern` (has border AND a background layer — the only pack with `bg`, 10 frames/row instead of 6, no custom dot_colors)**
  `node bin/peon-pet.js packs use orc-tavern`
  Expected: background image visible behind the sprite (zIndex layering: bg behind sprite, border in front — confirm no z-order glitches); animation plays smoothly despite the different frame count (10 vs 6); session dots render in the **default** green (this pack has no `dot_colors` — confirms the "reset to defaults per pack" fix from earlier in this session).

- [ ] **1.5 — `test-atlas` (no border, no bg, no dock icons, all 6 categories, very low density 0.3)**
  `node bin/peon-pet.js packs use test-atlas`
  Expected: no border frame drawn (pack has none); dock icon falls back to `orc`'s icon (pack has no `icons` block — confirms cross-pack fallback works for icons specifically, while sprite/border/bg never fall back per CEAP spec); window noticeably larger than `orc` at the same scale (density 0.3 vs 3.4 — same raw pixels, much bigger displayed size).

- [ ] **1.6 — `laptop-guy` (no border, only 4 categories — missing celebrate/annoyed, density 1.1)**
  `node bin/peon-pet.js packs use laptop-guy`
  Expected: renders normally for sleeping/waking/typing/alarmed. Now trigger a `celebrate` or `annoyed` event (see Section 2.6/2.7) — **expected: no visible reaction at all**, pet keeps doing whatever it was already doing. This is the CEAP category-fallback rule; confirm via DevTools console that `[peon-pet:state] anim` does NOT log a transition when this happens (the event is silently absorbed, not forwarded as a no-op — check for an absence of a new `anim` log line after the triggering event fires).

- [ ] **1.7 — Unknown pack name**
  `node bin/peon-pet.js packs use definitely-not-a-real-pack`
  Expected: CLI prints an error and lists available bundled packs; exits non-zero; does **not** change the running app's pack (switch back to a known pack afterward and confirm the app didn't silently break).

- [ ] **1.8 — `packs list`**
  `node bin/peon-pet.js packs list`
  Expected: prints "Bundled:" section with all 6 names, "Custom (~/.openpeon/pets):" section (likely empty unless you have custom packs), and a `*` prefix next to whichever pack is currently active in config.

---

## Section 2: Animation triggering (local, no real Claude Code needed)

The cleanest way to trigger real animation events without a live Claude Code session is writing directly to a fake JSONL file under `~/.claude/projects/`, since `lib/jsonl-watcher.js` reacts to any UUID-named `.jsonl` file appearing there (`lib/jsonl-watcher.js:16,70-86`: any file matching `<8-4-4-4-12 hex>.jsonl` directly inside a project subdirectory). We'll use this method for 2.1–2.5.

Setup — create the session file once:
```bash
mkdir -p ~/.claude/projects/test-project
SESSION_FILE=~/.claude/projects/test-project/$(uuidgen | tr '[:upper:]' '[:lower:]').jsonl
touch "$SESSION_FILE"
echo "Session file: $SESSION_FILE"
```
Keep that `$SESSION_FILE` variable for the rest of this section (re-export it if you start a new shell). Each step below appends one JSON line to it — `jsonl-watcher.js` polls every 500ms per file, so expect up to a ~1s delay after each `echo`.

Switch to `orc` first (`node bin/peon-pet.js packs use orc`) so all 6 categories are available for this section.

- [ ] **2.1 — `SessionStart` → `waking`**
  This fires automatically the moment `$SESSION_FILE` is first discovered as a brand-new file (`lib/jsonl-watcher.js`'s `_registerFile`/`SessionStart` vs `SessionSeen` distinction — only a file that didn't exist at startup scan time emits `SessionStart`). If you created the file *after* `npm run dev` was already running, this should have already fired during setup above — check DevTools history. If you need to re-trigger it, quit the app, delete `$SESSION_FILE`, relaunch `npm run dev`, then recreate the file.
  Expected: pet plays `waking` once, then settles into `sleeping` (no activity yet). DevTools: `[peon-pet:ipc] peon-event received {anim: waking, event: SessionStart}` followed by `[peon-pet:state] anim {from: sleeping, to: waking}`.

- [ ] **2.2 — `UserPromptSubmit` → `typing`**
  ```bash
  echo '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}' >> "$SESSION_FILE"
  ```
  Expected: pet plays `typing`. DevTools shows the IPC + anim-change log pair.

- [ ] **2.3 — `PermissionRequest` → `alarmed`**
  ```bash
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_test1","name":"Bash","input":{}}]}}' >> "$SESSION_FILE"
  ```
  This arms a 7-second timer (`PERMISSION_TIMEOUT_MS`, `lib/jsonl-watcher.js:12`) that only fires `PermissionRequest` if the tool is *still* pending (no matching `tool_result` appended) when it elapses — don't do step 2.4 with this same `toolu_test1` id first, or the timer cancels silently.
  Expected: after ~7s with nothing else appended, pet plays `alarmed`. Confirm the delay is real (not instant).

- [ ] **2.4 — `PostToolUseFailure` → `annoyed`**
  ```bash
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_test2","name":"Bash","input":{}}]}}' >> "$SESSION_FILE"
  echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_test2","is_error":true,"content":"failed"}]}}' >> "$SESSION_FILE"
  ```
  The `tool_use_id` in the second line must match the `id` from the first (this is how `jsonl-watcher.js` resolves the pending tool and also clears its permission timer — `_handleUser`, `lib/jsonl-watcher.js:302-320`).
  Expected: pet plays `annoyed` shortly after the second line (no 7s wait needed here, since this isn't the permission-timeout path).

- [ ] **2.5 — `Stop` → `celebrate`**
  ```bash
  echo '{"type":"system","subtype":"turn_duration"}' >> "$SESSION_FILE"
  ```
  Expected: pet plays `celebrate`, then (after the reaction completes — watch for `[peon-pet:state] anim {from: celebrate, to: ...}` in DevTools) returns to `typing` if a session is still tracked as active, or `sleeping` after the 30s idle timeout otherwise.

- [ ] **2.6 — `PreCompact` → `alarmed` (remote-relay only — confirm this is NOT reachable via JSONL)**
  Per the codebase inventory, `jsonl-watcher.js` never emits `PreCompact` locally. Skip triggering it here; it's covered in Section 10 (remote relay) instead. This step is just a note: if you see `alarmed` fire without triggering 2.3/2.4 above, investigate — it may mean something is miswired.

- [ ] **2.7 — Reaction-animation loop count**
  While triggering 2.2–2.5, watch the animation play through its full loop count (each category's `loops` value in `openpeon.json`, e.g. `typing`/`alarmed`/`celebrate`/`annoyed` all specify `loops: ` implicitly via the reaction-hold logic — default 3 total passes) before settling back to idle. Confirm it does NOT play one extra loop (this was a bug found and fixed during the rewrite — `remainingLoops = loops - 1`, not `loops`).

- [ ] **2.8 — Waking guard (don't re-wake if already awake)**
  While the pet is actively `typing` (not sleeping), trigger another `SessionStart` event (another fake `waking` event). Expected: **no visible effect** — the pet keeps typing, does not replay the waking animation. DevTools: `[peon-pet:event] dropped ('waking' ignored — already awake)`.

- [ ] **2.9 — Auto-sleep after 30s idle**
  Let the pet sit with no new events for 30+ seconds after it's in a non-sleeping state with no active sessions. Expected: pet returns to `sleeping`. DevTools: `[peon-pet:idle] timer armed (30s)` when the timer was set, then `[peon-pet:state] anim {from: ..., to: sleeping}` ~30s later.

---

## Section 3: Session dots and tooltip

- [ ] **3.1** — With at least one fake session tracked (from Section 2), hover the mouse over the pet (main window only, not sub-agent). Expected: a tooltip window appears near the cursor showing either per-dot detail (if hovering directly over a dot) or an aggregate summary.
- [ ] **3.2** — Hover directly over a single session dot. Expected: tooltip shows `<folder-name> • active|idle|cold` colored to match the pack's `dot_colors`.
- [ ] **3.3** — Move the mouse off the pet entirely. Expected: tooltip disappears.
- [ ] **3.4** — Start dragging the pet (press and hold). Expected: any visible tooltip disappears immediately, and does not reappear until you release and hover again.
- [ ] **3.5** — With zero tracked sessions, hover the pet. Expected: tooltip shows literally "Peon Pet" (no sessions text).
- [ ] **3.6** — Confirm dot count matches actual tracked sessions, not an inflated number. Per this session's investigation, a session dot persists for up to **10 minutes** after its last activity (not a bug) — if you see more dots than expected, check whether they correspond to genuinely recent activity (including this very terminal session) before assuming it's wrong.

---

## Section 4: Window dragging and position persistence

- [ ] **4.1** — Drag the main pet window to an arbitrary new position on screen.
- [ ] **4.2** — Quit the app fully (not just close the window — `Cmd+Q` or dock menu Quit) and relaunch with `npm run dev`. Expected: pet reappears at the **exact same position** you dragged it to.
- [ ] **4.3** — Drag the pet so part of it hangs off a screen edge. Expected: no crash; window stays wherever you release it (no automatic edge-snapping during drag — that's a separate, explicit "Snap to Corner" action, not automatic).
- [ ] **4.4** — While dragging, open DevTools and trigger a reload (`Cmd+R` in the DevTools-attached window). Expected: no stuck drag state after reload — clicking the pet afterward should register as a fresh click, not as if a drag is still in progress.

---

## Section 5: Settings (scale, border, corner-radius)

- [ ] **5.1 — Scale**
  `node bin/peon-pet.js scale 2`
  Expected: pet window visibly doubles in size within ~1s, no restart needed. Then `node bin/peon-pet.js scale` (no arg) should print `2`. Reset with `node bin/peon-pet.js scale 1`.
- [ ] **5.2 — Scale validation**
  `node bin/peon-pet.js scale -1` and `node bin/peon-pet.js scale abc`
  Expected: both print an error and exit non-zero; running app's scale is unaffected.
- [ ] **5.3 — Border toggle**
  `node bin/peon-pet.js border off` (while on a pack that has a border, e.g. `orc`). Expected: border frame disappears, window shrinks to just the sprite's bounds (no margin). `node bin/peon-pet.js border on` restores it.
- [ ] **5.4 — Border on a pack with no border asset**
  Switch to `test-atlas` or `laptop-guy`, then `node bin/peon-pet.js border on`. Expected: no crash, no border visible (pack has no border asset to draw), window size unaffected by the margin (no margin to apply).
- [ ] **5.5 — Corner radius**
  `node bin/peon-pet.js corner-radius 20`
  Expected: the pet window's visible corners become rounded (CSS `border-radius`, not an OS-level window shape change). Reset with `node bin/peon-pet.js corner-radius 0`.
- [ ] **5.6 — `corner` setting does NOT live-move the window**
  While the app is running, `node bin/peon-pet.js corner tr`. Expected: **the running window does NOT move** (per the codebase investigation, this setting only affects first-launch default position and the dock's "Snap to Corner" menu — it's not consulted by the config hot-reload path). This is expected behavior, not a bug — confirm it matches so you don't file a false report later.

---

## Section 6: Sub-agent windows

Requires either a real Task-tool subagent spawn, or the dev-only spawn flag.

- [ ] **6.1 — Dev spawn-test**
  `npm run dev -- --spawn-test`
  Expected: 3 small sub-agent windows appear (half the size of the main pet), each playing `waking`, stacked above the main window with no gaps/overlaps. After ~3 seconds, all 3 auto-destroy.
- [ ] **6.2 — Sub-agent visual differences**
  While a sub-agent window is visible (re-run 6.1 if needed, or trigger a real Task-tool subagent), confirm: no session dots ever appear on it; hovering it shows no tooltip; it cannot be dragged (clicking and dragging should do nothing — clicks pass through or are ignored).
  - [ ] **6.1a — Dot/border rendering correctness on a sub-agent's smaller canvas.** The canvas-sizing and sprite-positioning fixes from this session were verified on the main window at normal scale — confirm they also hold at the sub-agent's half-size window: sprite not cropped, fills its window correctly, no stale/frozen frame after its initial `waking` animation completes.
- [ ] **6.3 — Sub-agent only reacts to `waking`**
  With a sub-agent window open, trigger a `typing`/`celebrate`/`alarmed` event for its session (if testing with a real subagent) or via the main session's fake JSONL. Expected: the sub-agent window's sprite does **not** change in reaction — it stays on whatever frame its initial `waking` animation left it on. DevTools (on the sub-agent window's own DevTools instance, if attached): `[peon-pet:event] dropped (sub-agent only forwards 'waking')`.
- [ ] **6.4 — Max concurrent sub-agent windows (5)**
  If feasible, spawn 6+ concurrent Task-tool subagents (or temporarily hack the dev spawn-test to try 6). Expected: only 5 windows ever appear at once; the 6th silently doesn't get a window until one of the first 5 closes.
- [ ] **6.5 — Sub-agent TTL garbage collection**
  Not easily testable without waiting 10 minutes or manipulating the system clock — skip unless you have a specific reason to suspect this is broken. Note for awareness: a sub-agent window whose `SubagentStop` event never fires should still self-destroy after 10 minutes via the heartbeat GC.

---

## Section 7: Dock menu and icon (macOS only)

- [ ] **7.1** — Right-click (or control-click) the dock icon while the app is running. Expected: a menu with "Hide Pet" (or "Show Pet" if already hidden), a "Snap to Corner" submenu (4 positions), and "Quit".
- [ ] **7.2 — Hide/Show Pet**
  Click "Hide Pet". Expected: main window and tooltip disappear; sub-agent windows (if any) also disappear. Right-click the dock icon again — label should now say "Show Pet". Click it. Expected: main window reappears at its previous position; tooltip stays hidden (it has `autoShow: false`, only reappears on the next real hover) — hover the pet afterward to confirm the tooltip still works post-hide/show cycle.
- [ ] **7.3 — Snap to Corner**
  Click each of the 4 "Snap to Corner" options in turn (Bottom Left / Bottom Right / Top Left / Top Right). Expected: window instantly jumps to that screen corner each time. Quit and relaunch after the last one — confirm it persists (same as drag persistence in Section 4.2).
- [ ] **7.4 — Dock icon updates on pack switch**
  With the dock menu open or just visible, run `node bin/peon-pet.js packs use hello-kitty` then `node bin/peon-pet.js packs use orc`. Expected: dock icon visibly changes to match each pack, live, without restarting.
- [ ] **7.5 — Dock icon fallback**
  `node bin/peon-pet.js packs use test-atlas` (a pack with no `icons` block). Expected: dock icon falls back to `orc`'s icon rather than disappearing, going blank, or crashing.

---

## Section 8: Remote relay (peon-ping integration)

- [ ] **8.1 — No remote running (default state)**
  With no peon-ping server running, confirm the app starts and runs normally with no errors — the remote poll silently fails every 5s (connection refused, caught internally) and the pet still works fine via local JSONL watching alone.
- [ ] **8.2 — Point at an unreachable URL**
  `node bin/peon-pet.js remote http://127.0.0.1:1`
  Expected: no crash, no UI freeze (each poll attempt is bounded by a 150ms timeout). Reset after: `node bin/peon-pet.js remote http://127.0.0.1:19998`.
- [ ] **8.3 — Minimal mock remote server (optional, exercises the actual relay path)**
  Stand up a trivial local server on port 19998 serving `{"sessions": {"<any-uuid>": {"timestamp": <current-unix-seconds>, "cwd": "/tmp/mock", "event": "Stop"}}}` at `GET /state`. Example:
  ```bash
  node -e "
  require('http').createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sessions: { 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': { timestamp: Math.floor(Date.now()/1000), cwd: '/tmp/mock', event: 'Stop' } } }));
  }).listen(19998);
  "
  ```
  Expected within ~5s: pet plays `celebrate`, and a new session dot appears. Confirm via DevTools: no `[peon-pet:ipc] peon-event` log with `event: Stop` sourced from a *local* JSONL write — this one should be traceable to the remote path if you added a log there (not logged by default in this session's work — the remote path logging is a nice follow-up if you want full parity).
  Stop the mock server (`Ctrl+C`) afterward and confirm the app keeps running without error.
- [ ] **8.4 — `PreCompact` via remote**
  Repeat 8.3 but with `"event": "PreCompact"` instead of `"Stop"`. Expected: pet plays `alarmed` — this is the only reachable path for `PreCompact`, per the codebase inventory (jsonl-watcher never emits it locally).

---

## Section 9: CLI command edge cases

- [ ] **9.1** — `node bin/peon-pet.js corner invalid-value` — expect error + exit non-zero, no config change.
- [ ] **9.2** — `node bin/peon-pet.js corner-radius -5` — expect error (negative not allowed) + exit non-zero.
- [ ] **9.3** — `node bin/peon-pet.js border maybe` — expect error (must be exactly `on`/`off`) + exit non-zero.
- [ ] **9.4** — `--scale`/`--border`/`--pet` one-shot launch flags do not persist:
  `npm run dev -- --scale 3`, confirm the pet is 3x size for this launch, then quit and run `node bin/peon-pet.js scale` (no app running) — expected: still shows the previously-configured value, NOT `3` (one-shot override never wrote to config).
- [ ] **9.5** — `subAgentMargin` dead config key (low priority, confirms it's inert):
  Manually edit the config JSON (`~/Library/Application Support/Peon Pet/peon-pet-config.json` on macOS) to add `"subAgentMargin": 999`, relaunch, spawn a sub-agent window (`--spawn-test`). Expected: no visible difference in sub-agent window spacing — this key currently has no consumer in `main.js`.

---

## Section 10: Regression checks tied to specific bugs fixed this session

These are the most important checks — they directly target the issues found and fixed during the Pixi rewrite, and are the most likely place for a regression to hide.

- [ ] **10.1 — Canvas renders at the correct CSS size, not cropped.** On a Retina/HiDPI display (`devicePixelRatio` > 1), confirm the pet is never shown as an unscaled, cropped corner of a larger image. (Original bug: `canvas.style.width/height` was never set, only the backing buffer.)
- [ ] **10.2 — Border and background persist across EVERY animation category change, not just the first.** Switch through `sleeping → waking → typing → alarmed → celebrate → annoyed` (trigger each per Section 2) on `orc` (has a border) and `orc-tavern` (has bg + border) — confirm the border/bg never disappears after the first transition. (Original bug: `onVariantChanged`'s size-comparison guard skipped repositioning on every call after the first when size didn't change.)
- [ ] **10.3 — bg/border textures actually load (not just positioned).** On `orc-tavern`, confirm the background image is visible (not transparent/missing) immediately after a pack switch. (Original bug: bg/border sprites were created and sized but never had `.texture` assigned.)
- [ ] **10.4 — Dot hover hit-testing is accurate at the dot's actual rendered position**, not offset. Hover precisely over each visible dot (not near it) and confirm the tooltip responds exactly where the dot visually is. (Original bug: `computeDotLayout`/`hitTestDot` disagreed on coordinate space.)
- [ ] **10.5 — No `eventemitter3`/`unsafe-eval`/worker CSP console errors** at any point during this entire test plan. If any appear, the esbuild bundle may be stale — re-run `npm run build:renderer`.

---

## Wrap-up

- [ ] Restore your normal settings (`scale 1`, whatever pack/border/corner-radius you had before testing).
- [ ] Report any step whose expected outcome didn't match, with the DevTools console log excerpt from around that step if possible — the `[peon-pet:*]` logging added this session should make root-causing any failure much faster than before.
