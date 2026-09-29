'use strict';

const { EventEmitter } = require('events');

class WindowManager extends EventEmitter {
  constructor({ screen } = {}) {
    super();
    this._entries = new Map(); // key → { win, state }
    this._screen = screen || require('electron').screen;
    this._intervalId = null;
    this._dragging = new Map(); // key → true

    this.onBeforeTick = () => {};
    this.onAfterTick  = () => {};

    this.on('hide-all', () => {
      const visited = new Set();
      for (const [key, { state }] of this._entries) {
        if (state.linkedTo == null) this._cascade(key, false, visited);
      }
    });

    this.on('show-all', () => {
      const visited = new Set();
      for (const [key, { state }] of this._entries) {
        if (state.linkedTo == null) this._cascade(key, true, visited);
      }
    });

    this.on('drag-start', (key) => {
      const entry = this._entries.get(key);
      if (!entry || !entry.state.isDraggable || entry.win.isDestroyed()) return;
      const { win, state } = entry;
      const cursor = this._screen.getCursorScreenPoint();
      state._dragOffsetX = cursor.x - state.x;
      state._dragOffsetY = cursor.y - state.y;
      this._dragging.set(key, true);
      if (state.ignoreMouseEvents) {
        state.ignoreMouseEvents = false;
        win.setIgnoreMouseEvents(false);
      }
    });

    this.on('drag-stop', (key) => {
      const entry = this._entries.get(key);
      if (!entry || !entry.state.isDraggable) return;
      const { win, state } = entry;
      this._dragging.delete(key);
      if (!state.ignoreMouseEvents) {
        state.ignoreMouseEvents = true;
        if (!win.isDestroyed()) win.setIgnoreMouseEvents(true);
      }
      this.emit('drag-ended', key, { x: state.x, y: state.y });
    });
  }

  register(key, win, state) {
    const entry = { win, state: { ...state } };
    this._entries.set(key, entry);
    this._reconcile(entry);
    this._startLoop();
  }

  unregister(key) {
    this._entries.delete(key);
    this._dragging.delete(key);
    if (this._entries.size === 0) this._stopLoop();
  }

  getState(key) {
    const entry = this._entries.get(key);
    return entry ? { ...entry.state } : null;
  }

  updateState(key, patch) {
    const entry = this._entries.get(key);
    if (!entry) return;
    const { win, state } = entry;
    if (win.isDestroyed()) return;

    const prevVisible = state.visible;
    const prevX = state.x, prevY = state.y, prevW = state.width, prevH = state.height;
    const prevIgnore = state.ignoreMouseEvents;

    Object.assign(state, patch);

    if (state.visible !== prevVisible) {
      this._applyVisibility(entry, state.visible);
    }
    if (state.x !== prevX || state.y !== prevY || state.width !== prevW || state.height !== prevH) {
      win.setBounds({ x: state.x, y: state.y, width: state.width, height: state.height });
    }
    if (state.ignoreMouseEvents !== prevIgnore) {
      win.setIgnoreMouseEvents(state.ignoreMouseEvents);
    }
  }

  reorder(keys) {
    const next = new Map();
    for (const k of keys) {
      if (this._entries.has(k)) next.set(k, this._entries.get(k));
    }
    for (const [k, v] of this._entries) {
      if (!next.has(k)) next.set(k, v);
    }
    this._entries = next;
  }

  entries() {
    return this._entries.entries();
  }

  entriesByGroup(group) {
    const result = [];
    for (const [key, entry] of this._entries) {
      if (entry.state.group === group) result.push([key, entry]);
    }
    return result[Symbol.iterator]();
  }

  rankGroup(group) {
    const members = [];
    for (const [key, { state }] of this._entries) {
      if (state.group === group) members.push({ key, lastActivity: state.lastActivity });
    }
    members.sort((a, b) => b.lastActivity - a.lastActivity);
    return members.map(m => m.key);
  }

  gcGroup(group, { idleCutoff }) {
    const removed = [];
    for (const [key, { state }] of this._entries) {
      if (state.group === group && state.lastActivity < idleCutoff) {
        removed.push(key);
      }
    }
    for (const key of removed) this.unregister(key);
    return removed;
  }

  _applyVisibility(entry, visible) {
    const { win, state } = entry;
    if (win.isDestroyed()) return;
    if (visible) {
      state.showInactive ? win.showInactive() : win.show();
    } else {
      win.hide();
    }
    state.visible = visible;
  }

  // A freshly registered window is real (shown, ignoring-mouse, etc.) by
  // default — matching Electron's BrowserWindow — regardless of what its
  // initial state claims. Force the window to match its declared state once,
  // at entry, so every later idempotency guard in this class (which compares
  // against state rather than re-querying the window) is comparing against
  // the truth from the start.
  _reconcile(entry) {
    const { win, state } = entry;
    if (win.isDestroyed()) return;
    if (state.visible) {
      state.showInactive ? win.showInactive() : win.show();
    } else {
      win.hide();
    }
    win.setIgnoreMouseEvents(state.ignoreMouseEvents);
  }

  _cascade(key, visible, visited) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = this._entries.get(key);
    if (!entry) return;
    const { state } = entry;
    if (!visible || state.autoShow) {
      if (state.visible !== visible) this._applyVisibility(entry, visible);
    }
    for (const [childKey, { state: cs }] of this._entries) {
      if (cs.linkedTo === key) {
        // For children during hide, always hide. During show, respect autoShow.
        if (!visible || cs.autoShow) {
          const childEntry = this._entries.get(childKey);
          if (childEntry && cs.visible !== visible) {
            this._applyVisibility(childEntry, visible);
          }
        }
        this._cascade(childKey, visible, visited);
      }
    }
  }

  _tick(cursor) {
    this.onBeforeTick(cursor);
    for (const [key, { win, state }] of this._entries) {
      if (win.isDestroyed()) continue;
      if (this._dragging.get(key)) {
        const nx = cursor.x - state._dragOffsetX;
        const ny = cursor.y - state._dragOffsetY;
        if (nx !== state.x || ny !== state.y) {
          state.x = nx; state.y = ny;
          win.setPosition(nx, ny);
        }
        continue;
      }
      const inside = cursor.x >= state.x && cursor.x <= state.x + state.width
                  && cursor.y >= state.y && cursor.y <= state.y + state.height;
      const shouldIgnore = !inside;
      if (shouldIgnore !== state.ignoreMouseEvents) {
        state.ignoreMouseEvents = shouldIgnore;
        win.setIgnoreMouseEvents(shouldIgnore);
      }
    }
    this.onAfterTick(cursor);
  }

  _startLoop() {
    if (this._intervalId !== null) return;
    this._intervalId = setInterval(() => {
      this._tick(this._screen.getCursorScreenPoint());
    }, 50);
  }

  _stopLoop() {
    if (this._intervalId === null) return;
    clearInterval(this._intervalId);
    this._intervalId = null;
  }
}

function createMainWindowState(x, y, width, height) {
  return {
    visible: true, autoShow: true, showInactive: false,
    ignoreMouseEvents: true, isDraggable: true,
    x: x || 0, y: y || 0, width: width || 100, height: height || 100,
    group: null, lastActivity: 0, activity: 'active',
    linkedTo: null, zOrder: 1,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

function createTooltipWindowState(parentKey) {
  return {
    visible: false, autoShow: false, showInactive: true,
    ignoreMouseEvents: true, isDraggable: false,
    x: 0, y: 0, width: 10, height: 10,
    group: null, lastActivity: 0, activity: 'active',
    linkedTo: parentKey || null, zOrder: 2,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

function createSubAgentWindowState(parentKey, group, x, y, width, height) {
  return {
    visible: true, autoShow: true, showInactive: false,
    ignoreMouseEvents: true, isDraggable: false,
    x: x || 0, y: y || 0, width: width || 100, height: height || 100,
    group: group || null, lastActivity: Date.now(), activity: 'active',
    linkedTo: parentKey || null, zOrder: 1,
    _dragOffsetX: 0, _dragOffsetY: 0,
  };
}

module.exports = { WindowManager, createMainWindowState, createTooltipWindowState, createSubAgentWindowState };
