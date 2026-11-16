# Radial Sub-Agent Pet Placement & Lifecycle Fix

Date: 2026-09-25
Status: Approved for planning

## Problem

Sub-agent pet windows (spawned when a parent agent's own transcript shows
it invoking Task-style sub-agents) currently:

1. Stack vertically along the left edge of the screen
   (`repositionSubAgentWindows`, `main.js:296-306`) instead of clustering
   around the main pet.
2. Disappear prematurely while the sub-agent is still running, because
   despawn is driven by idle-timeouts and blanket turn-end clears rather
   than a real per-subagent completion signal
   (`lib/jsonl-watcher.js:13, 151-194, 265-280, 324-335`).

This is scoped **only** to sub-agent (Task-spawned) pet windows. The
existing dot-on-main-pet system for user-controlled sessions
(`lib/session-tracker.js`, hot/warm/off dots) is unrelated and untouched.

## Goals

- Sub-agent pets render as 0.5x-scaled pet windows arranged radially
  around the main pet, not stacked.
- Positions stay attached to the main window as it's dragged.
- A sub-agent pet despawns only when that specific sub-agent actually
  completes — not from an idle-write gap or a sibling/parent turn ending.
- At most 6 sub-agent pets are visible at once, chosen by activity
  priority, with the rest tracked but not shown until a slot frees up.
- Config/variant changes applied to the main pet propagate to visible
  sub-agent pets.

## Non-goals

- No change to the dot-on-main-pet system for user-controlled sessions.
- No change to tooltip window positioning (cursor-anchored clamping stays
  as-is — there was no existing radial logic to reuse; this spec
  introduces the first radial placement math in the codebase).
- Manual/triggered reactions on the main pet are not mirrored to
  sub-agent pets — only config/variant/scale/dot-color changes trickle
  down. Each sub-agent pet's own reactions come from its own subagent's
  activity.

## Design

### 1. Per-subagent activity tracking (new state)

Today `subAgentCreatedAt` (`main.js:32`) is set once at window creation
and never updated — it can't drive a recency ranking. Add:

- `subAgentLastActivity: Map<sessionId, timestamp>` — updated whenever
  `jsonl-watcher.js` reports any event for that subagent (new JSONL line,
  progress record). Replaces `subAgentCreatedAt` for anything but true
  creation-time bookkeeping (which stays, for the TTL safety net).
- `subAgentReacting: Set<sessionId>` — populated/cleared by IPC from each
  sub-agent renderer when it enters/exits a reaction animation
  (`waking`/`alarmed`/`celebrate`/`annoyed`, per `renderer/app.js:309-314`).
  Needed because main.js currently has no visibility into renderer-side
  animation state.

### 2. Ranking and top-6 selection

All known (still-running) sub-agents are tracked in an in-memory list,
independent of how many currently have windows. On every rank-relevant
event (subagent spawn, subagent stop, reaction start/end, activity
update), recompute:

- Tier order: `reacting` > `active` (recent JSONL activity / pending
  tool) > `sleeping` (no recent activity).
- Within a tier, sort by `subAgentLastActivity` descending (most recent
  first).
- Take the top 6. Diff against currently-visible windows:
  - Newly in top 6 → create a window (§4) at its rank's clock position.
  - Fell out of top 6 → destroy its window (no hide/park — simpler
    lifecycle, per approved design; a subagent that re-enters top 6
    later gets a fresh window).
  - Still in top 6 but rank shifted → reassign clock position only, no
    recreate.

`MAX_SUB_AGENT_WINDOWS` (`main.js:34`) changes from 5 to 6 to match the
six clock slots.

### 3. Radial placement math

Positions are computed relative to the main window's **live** bounds,
recalculated on every main-window `move` event and every reconciliation
pass from §2:

```
cx = mainX + mainWidth / 2
cy = mainY + mainHeight / 2
radius = mainWidth / 2 + subAgentMargin   // margin from config, see §5
```

Six fixed clock-face slots, assigned in rank order (rank 0 → first slot):

| Rank | Clock | Angle θ (0°=12, clockwise) |
|------|-------|----------------------------|
| 0 | 3 o'clock  | 90°  |
| 1 | 1 o'clock  | 30°  |
| 2 | 11 o'clock | 330° |
| 3 | 9 o'clock  | 270° |
| 4 | 7 o'clock  | 210° |
| 5 | 5 o'clock  | 150° |

```
x = cx + radius * sin(θ) - subWidth / 2
y = cy - radius * cos(θ) - subHeight / 2
```

`subWidth`/`subHeight` come from `computeWindowSize(variant, { scale,
subAgent: true })` (`lib/pet-size.js:24-32`), which already halves the
multiplier for sub-agent windows — no change needed there.

`repositionSubAgentWindows()` (`main.js:296-306`) is rewritten to this
formula, keyed by each window's assigned rank/slot instead of stack
order. It's called from the same places it is today, plus the main
window's `move` event (new listener) so sub-agent pets track dragging.

### 4. Despawn fix

Remove the two false-positive stop paths in `lib/jsonl-watcher.js`:

- Background subagents: stop firing `SubagentStop` from the
  `SUBAGENT_IDLE_MS` stale timer (`lib/jsonl-watcher.js:13, 175-182`).
  A subagent's file watcher stays open until the transcript itself
  contains a real completion record.
- Foreground subagents: stop bulk-clearing
  `state.activeSubagentToolIds` on every `turn_duration` record
  (`lib/jsonl-watcher.js:265-280`). Only emit `SubagentStop` for a
  specific `parentToolId` when its own result/completion record appears
  in the transcript.

`SUB_AGENT_TTL_MS` (`main.js:36`, 10 min) stays as-is, now truly a
last-resort safety net rather than the primary mechanism papering over
missing completion signals.

### 5. Config propagation + new config field

- `subAgentMargin` (px, default 12) added to the pet config schema
  (same file/mechanism as `windowX`/`windowY`/`scale` —
  `main.js:179-191` load/write). Read once like `scale` is today
  (`main.js:135-146` pattern).
- When the main pet receives a config/variant/dot-color change (hot
  reload path, `main.js:659-665`, or a `peon-pet` CLI command that
  mutates config), the same payload is now also sent via IPC to every
  window in `subAgentWindows`, reusing the existing per-window IPC init
  payload shape (`main.js:341-347`).

## Testing

- Unit: radial position formula (given main bounds + rank → expected
  x/y) for all 6 slots.
- Unit: ranking/reconciliation (tier ordering, top-6 diffing, create/
  destroy decisions) with synthetic activity/reaction event sequences.
- Unit: `jsonl-watcher.js` no longer emits `SubagentStop` on idle gap or
  on unrelated `turn_duration` records; only on a subagent's own
  completion record.
- Manual: drag main window, confirm sub-agent pets stay attached at
  their clock positions; spawn >6 concurrent sub-agents and confirm
  correct top-6 selection/swapping as activity changes; confirm a
  long-running-but-active sub-agent survives past the old 5s/bulk-clear
  triggers and only despawns on its own completion or the 10-min TTL.
