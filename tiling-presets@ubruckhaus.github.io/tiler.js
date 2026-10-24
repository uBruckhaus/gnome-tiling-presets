// Watches windows, keeps each workspace within its window limit and arranges
// its windows in the workspace's layout.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {computeLayout, slotAt, clampRatio, isTilingLayout, MASTER_LAYOUTS} from './layouts.js';
import {presetFor} from './config.js';

const RETILE_DELAY = 40;           // ms; collects bursts of window events into one pass
const UNMAXIMIZE_SETTLE = 200;     // ms; Wayland clients apply an unmaximize asynchronously
const READY_TIMEOUT = 500;         // ms; a new window counts as shown after this at the latest

// Per-window choices that outlive disable/enable (the screen lock) like the windows
// themselves: weak, so closed windows are not kept.
const kept = {
    natural: new WeakMap(),   // window -> size it opened with (for pseudo-tiling)
    pseudo: new WeakSet(),    // windows keeping their own size inside their tile
    scratch: new WeakSet(),   // windows on the scratchpad
};

export class Tiler {
    constructor(settings, log) {
        this._settings = settings;
        this._log = log;
        // Restoring an App Preset adopts new windows before overflow sees them.
        this.claimWindow = null;
        // Title bar double-clicks: sees maximize changes before the tiler reacts.
        this.maximizeHook = null;
    }

    enable() {
        this._seq = 0;
        this._order = new Map();       // window -> sequence number (window order in layouts)
        this._tracked = new Map();     // window -> {signals, workspace}
        this._placed = new WeakSet();  // windows this extension has arranged at least once
        this._opening = new WeakSet(); // new windows not shown yet; they join layouts when ready
        this._ratios = new WeakMap();  // workspace -> master share
        this._floatRects = new WeakMap(); // window -> where it floated last
        this._natural = kept.natural;
        this._pseudo = kept.pseudo;
        this._scratch = new Set();     // windows on the scratchpad, never tiled; see kept.scratch
        this._dirty = new Set();
        this._timeouts = new Set();
        this._retileId = 0;
        this._grab = null;
        this._signals = [];

        const display = global.display;
        const workspaces = global.workspace_manager;
        this._connect(display, 'window-created', (_d, window) => this._onWindowCreated(window));
        this._connect(display, 'grab-op-begin', (_d, window) => this._onGrabBegin(window));
        this._connect(display, 'grab-op-end', (_d, window) => this._onGrabEnd(window));
        this._connect(display, 'window-entered-monitor', (_d, _m, window) => this._queueFor(window));
        this._connect(display, 'workareas-changed', () => this.retileAll());
        this._connect(workspaces, 'workspace-added', () => this.retileAll());
        this._connect(workspaces, 'workspace-removed', () => this.retileAll());
        this._connect(workspaces, 'workspaces-reordered', () => this.retileAll());
        this._connect(this._settings, 'changed', (_s, key) => {
            if (['paused', 'default-layout', 'default-limit', 'workspace-presets', 'gap'].includes(key))
                this.retileAll();
        });

        // Existing windows keep their places (after unlocking, for example); maximized ones stay maximized.
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window.get_window_type() === Meta.WindowType.NORMAL);
        for (const window of windows.filter(w => this._isMaximized(w)))
            this._placed.add(window);
        const rank = new Map(windows.map(window => [window, this._currentSlot(window)]));
        windows.sort((a, b) => rank.get(a) - rank.get(b));
        windows.forEach(window => this._track(window));
        for (const window of windows) {
            this._rememberSize(window);
            if (kept.scratch.has(window))
                this._scratch.add(window);
        }
        this._readRatios();
        this.retileAll();
    }

    // After unlocking, master layouts keep the proportion their windows show.
    _readRatios() {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            if (!MASTER_LAYOUTS.includes(this._layoutFor(workspace)))
                continue;
            const windows = this.tileableWindows(workspace);
            const monitor = windows[0]?.get_monitor();
            const own = windows.filter(window => window.get_monitor() === monitor);
            if (own.length < 2)
                continue;
            // A pseudo-tiled window is narrower than its tile: measure one that fills it.
            // The stack column has the rest of the width.
            const area = workspace.get_work_area_for_monitor(monitor);
            const full = own.findIndex(window => !this._pseudo.has(window));
            if (full < 0)
                continue;
            const measured = this._masterShare(own[full], area);
            const share = full === 0 ? measured : clampRatio(1 - measured);
            if (Math.abs(share - 0.5) > 0.02)
                this._ratios.set(workspace, share);
        }
    }

    // The share of the layout's width a window has, as computeLayout() measures it.
    _masterShare(window, area) {
        const gap = this._settings.get_int('gap');
        const usable = area.width - 3 * gap;   // outer gaps and the one between the columns
        return clampRatio(window.get_frame_rect().width / Math.max(1, usable));
    }

    disable() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const window of [...this._tracked.keys()])
            this._untrack(window);
        if (this._retileId)
            GLib.source_remove(this._retileId);
        this._retileId = 0;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._dirty.clear();
        this._order.clear();
        this._scratch.clear();
        this._grab = null;
        this.claimWindow = null;
    }

    // --- Public helpers for App Presets and the menu -------------------------------

    get paused() {
        return this._settings.get_boolean('paused');
    }

    orderOf(window) {
        return this._order.get(window) ?? Number.MAX_SAFE_INTEGER;
    }

    // Reserves `count` consecutive sequence numbers and returns the first.
    reserveOrder(count) {
        const first = this._seq + 1;
        this._seq += count;
        return first;
    }

    setOrder(window, seq) {
        this._order.set(window, seq);
        this._queueFor(window);
    }

    markPlaced(window) {
        this._placed.add(window);
    }

    isTracked(window) {
        return this._tracked?.has(window) ?? false;
    }

    requeue(window) {
        this._queueFor(window);
    }

    moveToEnd(window) {
        this.setOrder(window, ++this._seq);
    }

    isTileable(window) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL || this._opening.has(window))
            return false;
        if (this._scratch.has(window))
            return false;
        if (window.minimized || window.is_fullscreen() || window.is_above() ||
            window.is_on_all_workspaces() || window.is_skip_taskbar())
            return false;
        if (window.get_transient_for() || !window.allows_resize())
            return false;
        // A window the user maximized after it was arranged stays out until restored.
        return !(this._placed.has(window) && this._isMaximized(window));
    }

    tileableWindows(workspace) {
        return workspace.list_windows()
            .filter(window => this.isTileable(window))
            .sort((a, b) => this.orderOf(a) - this.orderOf(b));
    }

    // Window limit of a workspace index, or 0 when it takes any number of windows.
    limitFor(index) {
        const preset = presetFor(this._settings, index + 1);
        return isTilingLayout(preset.layout) ? preset.limit : 0;
    }

    // The first workspace after `index` with room; may be one past the last workspace.
    // With a fixed number of workspaces a new one would raise GNOME's count for good, so
    // then only existing ones count, and -1 means none has room.
    findRoom(index) {
        const manager = global.workspace_manager;
        for (let i = index + 1; i < manager.n_workspaces; i++) {
            const limit = this.limitFor(i);
            const workspace = manager.get_workspace_by_index(i);
            if (!limit || this.tileableWindows(workspace).length < limit)
                return i;
        }
        return Meta.prefs_get_dynamic_workspaces() ? manager.n_workspaces : -1;
    }

    layoutOf(workspace) {
        return this._layoutFor(workspace);
    }

    // Tiled: a tileable window on a workspace with a tiling layout, tiling not paused.
    isTiled(window) {
        const workspace = window?.get_workspace();
        return Boolean(workspace) && !this.paused && this.isTileable(window) &&
            isTilingLayout(this._layoutFor(workspace));
    }

    // Floating windows are "Always on Top", which keeps them out of layouts and above
    // the tiled windows. They float centred, or where they floated last.
    toggleFloating(window) {
        if (window.is_above()) {
            const frame = window.get_frame_rect();
            this._floatRects.set(window, {x: frame.x, y: frame.y, width: frame.width, height: frame.height});
            window.unmake_above();
            return;
        }
        const workspace = window.get_workspace() ?? global.workspace_manager.get_active_workspace();
        window.make_above();
        const area = workspace.get_work_area_for_monitor(window.get_monitor());
        let rect = this._floatRects.get(window);
        const fits = rect && rect.x >= area.x && rect.y >= area.y &&
            rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
        if (!fits) {
            const width = Math.round(area.width * 0.6);
            const height = Math.round(area.height * 0.7);
            rect = {
                x: area.x + Math.round((area.width - width) / 2),
                y: area.y + Math.round((area.height - height) / 2),
                width, height,
            };
        }
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
        window.raise();
    }

    // Two tiled windows trade places.
    swap(window, other) {
        const seq = this._order.get(window);
        this._order.set(window, this._order.get(other));
        this._order.set(other, seq);
        this._queueFor(window);
    }

    // Resizing a tiled window by `dx` pixels changes the master's share in the master
    // layouts. Returns false where tiled windows cannot change size.
    resizeTiled(window, dx) {
        const workspace = window.get_workspace();
        if (!dx || !MASTER_LAYOUTS.includes(this._layoutFor(workspace)))
            return false;
        const {windows, area} = this._slots(workspace, window.get_monitor());
        const index = windows.indexOf(window);
        if (windows.length < 2 || index < 0)
            return false;
        const usable = Math.max(1, area.width - 3 * this._settings.get_int('gap'));
        const share = this._ratios.get(workspace) ?? 0.5;
        // The master grows with its own width; a stack window grows by shrinking the master.
        const change = (index === 0 ? dx : -dx) / usable;
        this._ratios.set(workspace, clampRatio(share + change));
        this._queue(workspace);
        return true;
    }

    togglePseudo(window) {
        if (this._pseudo.has(window))
            this._pseudo.delete(window);
        else
            this._pseudo.add(window);
        this._queueFor(window);
    }

    isScratch(window) {
        return this._scratch.has(window);
    }

    setScratch(window, on) {
        if (on) {
            this._scratch.add(window);
            kept.scratch.add(window);
        } else {
            this._scratch.delete(window);
            kept.scratch.delete(window);
        }
        this._queueFor(window);
    }

    scratchWindows() {
        return [...this._scratch];
    }

    retileAll() {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++)
            this._queue(manager.get_workspace_by_index(i));
    }

    // Sort key for an existing window: the layout slot its centre is in, then its position.
    _currentSlot(window) {
        const frame = window.get_frame_rect();
        const workspace = window.get_workspace();
        let slot = 99;
        if (workspace && this.isTileable(window)) {
            const monitor = window.get_monitor();
            const count = workspace.list_windows()
                .filter(w => w.get_monitor() === monitor && this.isTileable(w)).length;
            const rects = computeLayout(this._layoutFor(workspace), count,
                workspace.get_work_area_for_monitor(monitor), this._settings.get_int('gap'));
            const found = slotAt(rects, frame.x + frame.width / 2, frame.y + frame.height / 2);
            if (found >= 0)
                slot = found;
        }
        return slot * 1e8 + frame.y * 1e4 + frame.x;
    }

    // --- Window tracking ----------------------------------------------------------

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _track(window) {
        if (this._tracked.has(window))
            return;
        const info = {workspace: window.get_workspace(), signals: []};
        const on = (signal, callback) => info.signals.push(window.connect(signal, callback));
        on('workspace-changed', () => {
            this._queue(info.workspace);
            info.workspace = window.get_workspace();
            // A window moved to another workspace joins the end of its layout.
            this._order.set(window, ++this._seq);
            this._queue(info.workspace);
        });
        on('unmanaged', () => {
            this._queue(info.workspace);
            this._untrack(window);
        });
        for (const property of ['minimized', 'fullscreen', 'above', 'on-all-workspaces'])
            on(`notify::${property}`, () => this._queueFor(window));
        // A title bar double-click arrives as a maximize; that module decides first.
        for (const property of ['maximized-horizontally', 'maximized-vertically']) {
            on(`notify::${property}`, () => {
                if (!this.maximizeHook?.(window))
                    this._queueFor(window);
            });
        }
        this._tracked.set(window, info);
        this._order.set(window, ++this._seq);
    }

    _untrack(window) {
        const info = this._tracked.get(window);
        if (!info)
            return;
        this._stopWaiting(window, info);
        for (const id of info.signals)
            window.disconnect(id);
        this._tracked.delete(window);
        this._order.delete(window);
        this._scratch.delete(window);
        if (this._grab?.window === window)
            this._grab = null;
    }

    _onWindowCreated(window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._track(window);
        this._opening.add(window);
        // Size and position are only reliable once the window is shown. Whichever comes
        // first: its first frame, the shown signal, or a timeout (headless shells never paint).
        const info = this._tracked.get(window);
        const actor = window.get_compositor_private();
        const ready = () => {
            if (!info.waiting)
                return;
            this._stopWaiting(window, info);
            this._onWindowReady(window);
        };
        info.waiting = {
            actor,
            actorId: actor ? actor.connect('first-frame', ready) : 0,
            shownId: window.connect('shown', ready),
            timeoutId: GLib.timeout_add(GLib.PRIORITY_DEFAULT, READY_TIMEOUT, () => {
                info.waiting.timeoutId = 0;
                ready();
                return GLib.SOURCE_REMOVE;
            }),
        };
    }

    _stopWaiting(window, info) {
        const waiting = info.waiting;
        if (!waiting)
            return;
        info.waiting = null;
        this._opening.delete(window);
        if (waiting.actorId)
            waiting.actor.disconnect(waiting.actorId);
        window.disconnect(waiting.shownId);
        if (waiting.timeoutId)
            GLib.source_remove(waiting.timeoutId);
    }

    _onWindowReady(window) {
        this._log(`ready: "${window.get_title()}" on workspace ${(window.get_workspace()?.index() ?? -2) + 1}, ` +
            `tileable ${this.isTileable(window)}`);
        this._rememberSize(window);
        if (this.claimWindow?.(window))
            return;
        if (!this.paused)
            this._overflow(window);
        this._queueFor(window);
    }

    // Moves a new window on to the next workspace with room when its own is full.
    _overflow(window) {
        const workspace = window.get_workspace();
        if (!workspace || !this.isTileable(window))
            return;
        const index = workspace.index();
        const limit = this.limitFor(index);
        if (!limit || this.tileableWindows(workspace).length <= limit)
            return;
        const target = this.findRoom(index);
        if (target < 0) {
            this._log(`overflow: no fixed workspace has room for "${window.get_title()}"`);
            return;
        }
        this._log(`overflow: "${window.get_title()}" from workspace ${index + 1} to ${target + 1}`);
        window.change_workspace_by_index(target, true);
        if (this._settings.get_boolean('follow-overflow')) {
            global.workspace_manager.get_workspace_by_index(target)
                ?.activate_with_focus(window, global.get_current_time());
        }
    }

    // --- Arranging ------------------------------------------------------------------

    _queueFor(window) {
        this._queue(window?.get_workspace());
    }

    _queue(workspace) {
        if (!workspace)
            return;
        this._dirty.add(workspace);
        if (this._retileId)
            return;
        this._retileId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETILE_DELAY, () => {
            this._retileId = 0;
            const manager = global.workspace_manager;
            const current = new Set();
            for (let i = 0; i < manager.n_workspaces; i++)
                current.add(manager.get_workspace_by_index(i));
            const dirty = [...this._dirty].filter(workspace => current.has(workspace));
            this._dirty.clear();
            for (const workspace of dirty)
                this._arrange(workspace);
            return GLib.SOURCE_REMOVE;
        });
    }

    _later(delay, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _layoutFor(workspace) {
        return presetFor(this._settings, workspace.index() + 1).layout;
    }

    // The windows of one monitor on a workspace and their target rectangles.
    _slots(workspace, monitor, windows = null) {
        windows ??= this.tileableWindows(workspace).filter(window => window.get_monitor() === monitor);
        const area = workspace.get_work_area_for_monitor(monitor);
        const rects = computeLayout(this._layoutFor(workspace), windows.length, area,
            this._settings.get_int('gap'), this._ratios.get(workspace) ?? 0.5);
        return {windows, rects, area};
    }

    _arrange(workspace) {
        if (this.paused || !isTilingLayout(this._layoutFor(workspace)))
            return;
        const byMonitor = new Map();
        for (const window of this.tileableWindows(workspace)) {
            const monitor = window.get_monitor();
            if (!byMonitor.has(monitor))
                byMonitor.set(monitor, []);
            byMonitor.get(monitor).push(window);
        }
        let settle = false;
        for (const [monitor, list] of byMonitor) {
            const {windows, rects} = this._slots(workspace, monitor, list);
            windows.forEach((window, i) => {
                settle = this._place(window, rects[i]) || settle;
            });
        }
        if (settle)
            this._later(UNMAXIMIZE_SETTLE, () => this._queue(workspace));
    }

    // The size a window opened with, before any layout changed it.
    _rememberSize(window) {
        if (this._natural.has(window) || this._isMaximized(window))
            return;
        const {width, height} = window.get_frame_rect();
        this._natural.set(window, {width, height});
    }

    // Returns true when the window had to be unmaximized first.
    _place(window, rect) {
        const unmaximize = window.get_maximize_flags() !== 0;
        if (unmaximize)
            window.unmaximize();
        this._placed.add(window);
        const natural = this._pseudo.has(window) && this._natural.get(window);
        if (natural) {
            // Pseudo-tiled: its own size, no larger than the tile, centred in it.
            const width = Math.min(natural.width, rect.width);
            const height = Math.min(natural.height, rect.height);
            rect = {
                x: rect.x + Math.round((rect.width - width) / 2),
                y: rect.y + Math.round((rect.height - height) / 2),
                width, height,
            };
        }
        const frame = window.get_frame_rect();
        if (frame.x === rect.x && frame.y === rect.y &&
            frame.width === rect.width && frame.height === rect.height)
            return unmaximize;
        this._log(`place "${window.get_title()}" at ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
        return unmaximize;
    }

    _isMaximized(window) {
        return window.get_maximize_flags() === Meta.MaximizeFlags.BOTH;
    }

    // --- Dragging and resizing --------------------------------------------------------

    _onGrabBegin(window) {
        this._grab = this.isTileable(window) ? {window, frame: window.get_frame_rect()} : null;
    }

    _onGrabEnd(window) {
        const grab = this._grab;
        this._grab = null;
        if (!grab || grab.window !== window || this.paused)
            return;
        const workspace = window.get_workspace();
        if (!workspace || !isTilingLayout(this._layoutFor(workspace)))
            return;
        const frame = window.get_frame_rect();
        const {windows, rects, area} = this._slots(workspace, window.get_monitor());
        const index = windows.indexOf(window);

        if (frame.width !== grab.frame.width || frame.height !== grab.frame.height) {
            // Resizing in a master layout changes the master's share; elsewhere it snaps back.
            const layout = this._layoutFor(workspace);
            if (MASTER_LAYOUTS.includes(layout) && windows.length > 1 && index >= 0) {
                const share = this._masterShare(window, area);
                this._ratios.set(workspace, index === 0 ? share : clampRatio(1 - share));
            }
        } else if (index >= 0) {
            // Dropping a window on another one swaps their places.
            const [x, y] = global.get_pointer();
            const target = slotAt(rects, x, y);
            if (target >= 0 && target !== index) {
                const other = windows[target];
                const seq = this._order.get(window);
                this._order.set(window, this._order.get(other));
                this._order.set(other, seq);
            }
        }
        this._queue(workspace);
    }
}
