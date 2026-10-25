// The Omarchy shortcuts switched on in the Shortcuts page. Rows handled by GNOME's own
// shortcuts only move keys around in GNOME's settings (see keys.js); the others are
// keybindings of this extension, handled here.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {presetFor, readJSON, setWorkspacePreset} from './config.js';
import {layoutName} from './indicator.js';
import {ROWS, gnomeKeybindings, planKeybindings} from './keys.js';
import {LAYOUTS, isTilingLayout} from './layouts.js';

const KEYBINDINGS_SCHEMA = 'org.gnome.shell.extensions.tiling-presets.keybindings';
const SCROLL_PAUSE = 150;   // ms between two workspace switches by mouse wheel
const MIN_SIZE = 100;       // px; keyboard resizing stops here
const REBIND_DELAY = 500;   // ms; GNOME has applied its changed shortcuts by then
// Probing where a key name is in the current layout: a combination nobody uses.
const PROBE_MODIFIERS = '<Control><Alt><Shift><Super>';
const PROBE_MASK = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.MOD4_MASK;

const DIRECTIONS = {
    left: {dx: -1, dy: 0, display: Meta.DisplayDirection.LEFT},
    right: {dx: 1, dy: 0, display: Meta.DisplayDirection.RIGHT},
    up: {dx: 0, dy: -1, display: Meta.DisplayDirection.UP},
    down: {dx: 0, dy: 1, display: Meta.DisplayDirection.DOWN},
};

const centre = rect => [rect.x + rect.width / 2, rect.y + rect.height / 2];

export class Shortcuts {
    constructor(extension, settings, tiler, overrides, log) {
        this._extension = extension;
        this._settings = settings;
        this._tiler = tiler;
        this._overrides = overrides;
        this._log = log;
    }

    enable() {
        this._keys = this._extension.getSettings(KEYBINDINGS_SCHEMA);
        this._bound = new Set();
        this._widths = new WeakMap();
        this._scroll = {id: 0, last: 0, delta: 0};
        this._rebindId = 0;
        this._syncId = 0;
        this._applied = null;
        this._codes = new Map();   // key name -> key codes in the current layout
        const manager = global.workspace_manager;
        // Workspaces, not numbers: dynamic workspaces renumber when one is removed.
        this._current = manager.get_active_workspace();
        this._former = null;
        this._ids = [
            [this._settings, this._settings.connect('changed::shortcuts', () => this._queueSync())],
            [this._keys, this._keys.connect('changed', () => this._queueSync())],
            // Another layout can put GNOME's shortcuts on other keys.
            ...['keymap-changed', 'keymap-layout-group-changed'].map(signal =>
                [global.backend, global.backend.connect(signal, () => {
                    this._codes.clear();
                    this._applied = null;
                    this._queueSync();
                })]),
            // Also reported when renumbering moves the active workspace; that is no switch.
            [manager, manager.connect('active-workspace-changed', () => {
                const active = manager.get_active_workspace();
                if (active === this._current)
                    return;
                this._former = this._current;
                this._current = active;
            })],
        ];
        this.sync();
    }

    disable() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._ids = [];
        for (const id of [this._rebindId, this._syncId].filter(Boolean))
            GLib.source_remove(id);
        this._rebindId = this._syncId = 0;
        this._unbindAll();
        this._setScroll(false);
        this._keys = null;
    }

    _enabledRows() {
        const ids = new Set(this._settings.get_strv('shortcuts'));
        return ROWS.filter(row => ids.has(row.id));
    }

    // dconf can report every key of a folder as changed at once, values unchanged; such
    // bursts become one sync, which does nothing when no shortcut or key really changed.
    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncId = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    // GNOME's settings first, so its shortcuts let go of the keys before ours take them.
    // GNOME applies its changes a little later, and a key it lets go of then can take
    // ours along (seen with Super + ^ at login), so the keys are bound once more after that.
    sync() {
        const rows = this._enabledRows();
        const applied = JSON.stringify(rows.map(row => [row.id, ...(row.bindings ?? []).map(name => this._keys.get_strv(name))]));
        if (applied === this._applied)
            return;
        this._applied = applied;
        const changed = this._syncGnome(rows, name => this._keys.get_strv(name));
        this._bindRows(rows);
        if (this._rebindId)
            GLib.source_remove(this._rebindId);
        this._rebindId = !changed ? 0 : GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBIND_DELAY, () => {
            this._rebindId = 0;
            this._bindRows(this._enabledRows());
            return GLib.SOURCE_REMOVE;
        });
        this._setScroll(rows.some(row => row.id === 'workspace-scroll'));
        this._log(`shortcuts: ${rows.map(row => row.id).join(', ') || 'none'}`);
    }

    // The key codes a key name is on in the current layout, found by binding it for a
    // moment and asking Mutter which keys trigger it; null when it cannot be bound.
    _resolve(name) {
        if (this._codes.has(name))
            return this._codes.get(name);
        const display = global.display;
        const action = display.grab_accelerator(`${PROBE_MODIFIERS}${name}`, Meta.KeyBindingFlags.NONE);
        let codes = null;
        if (action) {
            codes = [];
            for (let code = 8; code < 256; code++) {
                if (display.get_keybinding_action(code, PROBE_MASK) === action)
                    codes.push(code);
            }
            display.ungrab_accelerator(action);
        }
        this._codes.set(name, codes);
        return codes;
    }

    _bindRows(rows) {
        this._unbindAll();
        for (const row of rows) {
            if (row.gnome || !row.bindings)
                continue;
            for (const name of row.bindings)
                this._bind(name, row);
        }
    }

    // Returns true when a GNOME setting changed.
    _syncGnome(rows, accelsOf) {
        const gnome = gnomeKeybindings(readJSON(this._settings, 'saved-gnome-settings'));
        const plan = planKeybindings(rows, accelsOf, gnome, name => this._resolve(name));
        let changed = false;
        const apply = (key, value, schema) => {
            const before = this._overrides.current(key, schema);
            this._overrides.setOrRelease(key, value, schema);
            changed ||= before !== null && !before.equal(this._overrides.current(key, schema));
        };
        for (const {schema, key} of gnome)
            apply(key, new GLib.Variant('as', plan.get(`${schema} ${key}`)), schema);
        // Settings rows (Super + right mouse drag).
        for (const row of ROWS.filter(r => r.setting)) {
            const [schema, key, value] = row.setting;
            if (rows.includes(row))
                this._overrides.setOrRelease(key, new GLib.Variant('b', value), schema);
            else
                this._overrides.release(key, schema);
        }
        return changed;
    }

    _bind(name, row) {
        const handler = this._handler(name);
        if (!handler)
            return;
        // Repeating keys make sense for resizing only.
        const flags = name.startsWith('resize-') ? Meta.KeyBindingFlags.NONE
            : Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
        const action = Main.wm.addKeybinding(name, this._keys, flags, Shell.ActionMode.NORMAL,
            (_display, window, _event, binding) => {
                try {
                    handler(window ?? global.display.focus_window, binding);
                } catch (e) {
                    console.error(`[Tiling Presets] shortcut ${name}: ${e}`);
                }
            });
        if (action === Meta.KeyBindingAction.NONE)
            this._log(`shortcut ${name} (${row.id}) could not be bound`);
        else
            this._bound.add(name);
    }

    _unbindAll() {
        for (const name of this._bound)
            Main.wm.removeKeybinding(name);
        this._bound.clear();
    }

    // The function for a binding: (window, binding) => void.
    _handler(name) {
        let match = name.match(/^workspace-(\d+)$/);
        if (match)
            return () => this._switchTo(Number(match[1]) - 1);
        match = name.match(/^window-to-workspace-(silent-)?(\d+)$/);
        if (match) {
            const silent = Boolean(match[1]);
            return window => this._moveTo(window, Number(match[2]) - 1, !silent);
        }
        match = name.match(/^(focus|swap)-(left|right|up|down)$/);
        if (match) {
            const direction = DIRECTIONS[match[2]];
            return match[1] === 'focus' ? window => this._focus(window, direction)
                : window => this._swap(window, direction);
        }
        match = name.match(/^resize-(narrower|wider|shorter|taller)$/);
        if (match) {
            const sign = ['narrower', 'shorter'].includes(match[1]) ? -1 : 1;
            const horizontal = ['narrower', 'wider'].includes(match[1]);
            return (window, binding) => {
                const step = sign * this._step(binding);
                this._resize(window, horizontal ? step : 0, horizontal ? 0 : step);
            };
        }
        return {
            'workspace-former': () => this._switchToFormer(),
            'close-all': () => this._closeAll(),
            'toggle-floating': window => this._floating(window),
            'pop-out': window => this._popOut(window),
            'toggle-split': () => this._toggleSplit(),
            'pseudo-tile': window => window && this._tiler.togglePseudo(window),
            'cycle-layout': () => this._cycleLayout(1),
            'cycle-layout-backward': () => this._cycleLayout(-1),
            'save-width': window => window && this._widths.set(window, window.get_frame_rect().width),
            'restore-width': window => this._restoreWidth(window),
            'monitor-next': () => this._focusMonitor(1),
            'monitor-previous': () => this._focusMonitor(-1),
            'scratchpad': () => this._toggleScratchpad(),
            'to-scratchpad': window => this._toScratchpad(window),
        }[name] ?? null;
    }

    // Alt: a little, Ctrl: a lot.
    _step(binding) {
        const mods = binding.get_modifiers();
        if (mods & Clutter.ModifierType.MOD1_MASK)
            return 25;
        if (mods & Clutter.ModifierType.CONTROL_MASK)
            return 300;
        return 100;
    }

    // --- Workspaces -------------------------------------------------------------------

    // A workspace past the last one: with dynamic workspaces that is GNOME's empty last
    // workspace; a fixed number of workspaces is never raised.
    _target(index, adding) {
        const count = global.workspace_manager.n_workspaces;
        if (index < count)
            return index;
        if (!Meta.prefs_get_dynamic_workspaces())
            return -1;
        return adding ? count : count - 1;
    }

    _switchTo(index) {
        const target = this._target(index, false);
        if (target >= 0)
            global.workspace_manager.get_workspace_by_index(target)?.activate(global.get_current_time());
    }

    // The workspace used last, unless GNOME has removed it since.
    _switchToFormer() {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            if (workspace === this._former && workspace !== manager.get_active_workspace()) {
                workspace.activate(global.get_current_time());
                return;
            }
        }
    }

    _moveTo(window, index, follow) {
        if (!window || window.is_on_all_workspaces())
            return;
        const target = this._target(index, true);
        if (target < 0 || target === window.get_workspace()?.index())
            return;
        if (follow)
            this._tiler.moveAndFollow(window, target);
        else
            window.change_workspace_by_index(target, true);
    }

    _setScroll(on) {
        if (on && !this._scroll.id) {
            this._scroll.id = global.stage.connect('captured-event', (_stage, event) => this._onScroll(event));
        } else if (!on && this._scroll.id) {
            global.stage.disconnect(this._scroll.id);
            this._scroll.id = 0;
        }
    }

    // Super + mouse wheel: down is the next workspace, up the previous one.
    _onScroll(event) {
        if (event.type() !== Clutter.EventType.SCROLL || Main.actionMode !== Shell.ActionMode.NORMAL)
            return Clutter.EVENT_PROPAGATE;
        const super_ = Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;
        if (!(event.get_state() & super_))
            return Clutter.EVENT_PROPAGATE;
        let step = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.DOWN:
            step = 1;
            break;
        case Clutter.ScrollDirection.UP:
            step = -1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            this._scroll.delta += event.get_scroll_delta()[1];
            if (Math.abs(this._scroll.delta) >= 1) {
                step = Math.sign(this._scroll.delta);
                this._scroll.delta = 0;
            }
            break;
        }
        }
        const now = GLib.get_monotonic_time() / 1000;
        if (step && now - this._scroll.last >= SCROLL_PAUSE) {
            this._scroll.last = now;
            const workspace = global.workspace_manager.get_active_workspace()
                .get_neighbor(step > 0 ? Meta.MotionDirection.RIGHT : Meta.MotionDirection.LEFT);
            workspace?.activate(global.get_current_time());
        }
        return Clutter.EVENT_STOP;
    }

    // --- Focus and move -----------------------------------------------------------------

    // Windows shown on the active workspace, on every monitor, most recently used first.
    _visibleWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(window => !window.minimized && window.showing_on_its_workspace());
    }

    // The window nearest to `from` in a direction: mostly along it, a little across it.
    _nearest(from, windows, {dx, dy}) {
        const [fx, fy] = centre(from.get_frame_rect());
        let best = null;
        let bestScore = Infinity;
        for (const window of windows) {
            if (window === from)
                continue;
            const [x, y] = centre(window.get_frame_rect());
            const along = (x - fx) * dx + (y - fy) * dy;
            if (along <= 0)
                continue;
            const across = Math.abs((x - fx) * dy) + Math.abs((y - fy) * dx);
            const score = along + 2 * across;
            if (score < bestScore) {
                bestScore = score;
                best = window;
            }
        }
        return best;
    }

    _focus(window, direction) {
        const windows = this._visibleWindows();
        const target = window ? this._nearest(window, windows, direction) : windows[0];
        target?.activate(global.get_current_time());
    }

    // Tiled windows trade places with their neighbour; with none in that direction (or
    // for a floating window) the window moves to the next monitor that way.
    _swap(window, direction) {
        if (!window)
            return;
        if (this._tiler.isTiled(window)) {
            const neighbours = this._tiler.tileableWindows(window.get_workspace())
                .filter(w => w.get_monitor() === window.get_monitor());
            const other = this._nearest(window, neighbours, direction);
            if (other) {
                this._tiler.swap(window, other);
                return;
            }
        }
        const monitor = global.display.get_monitor_neighbor_index(window.get_monitor(), direction.display);
        if (monitor >= 0)
            window.move_to_monitor(monitor);
    }

    _focusMonitor(step) {
        const display = global.display;
        const count = display.get_n_monitors();
        if (count < 2)
            return;
        const current = display.focus_window?.get_monitor() ?? display.get_current_monitor();
        const monitor = (current + step + count) % count;
        const window = this._visibleWindows().find(w => w.get_monitor() === monitor);
        if (window) {
            window.activate(global.get_current_time());
            return;
        }
        // An empty monitor: move the pointer there, so new windows open on it.
        const rect = display.get_monitor_geometry(monitor);
        const [x, y] = centre(rect);
        global.stage.context.get_backend().get_default_seat().warp_pointer(Math.round(x), Math.round(y));
    }

    // --- Window state -------------------------------------------------------------------

    _closeAll() {
        const time = global.get_current_time();
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (window.get_window_type() === Meta.WindowType.NORMAL && !window.is_skip_taskbar())
                window.delete(time);
        }
    }

    _floating(window) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        if (window.get_maximize_flags())
            window.unmaximize();
        this._tiler.toggleFloating(window);
    }

    // Float and show on all workspaces, or put a popped-out window back.
    _popOut(window) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        if (window.is_on_all_workspaces() && window.is_above()) {
            window.unstick();
            this._tiler.toggleFloating(window);
            return;
        }
        if (!window.is_above())
            this._floating(window);
        window.stick();
    }

    _setLayout(layout) {
        const number = global.workspace_manager.get_active_workspace_index() + 1;
        const {limit} = presetFor(this._settings, number);
        setWorkspacePreset(this._settings, number, {layout, limit});
        const icon = Gio.FileIcon.new(this._extension.dir.resolve_relative_path(`icons/layout-${layout}-symbolic.svg`));
        Main.osdWindowManager.showAll(icon, layoutName(layout), null, null);
    }

    _cycleLayout(step) {
        const {layout} = presetFor(this._settings, global.workspace_manager.get_active_workspace_index() + 1);
        const index = Math.max(0, LAYOUTS.indexOf(layout));
        this._setLayout(LAYOUTS[(index + step + LAYOUTS.length) % LAYOUTS.length]);
    }

    // Side by side splits left and right, Stacked top and bottom; other layouts start with Stacked.
    _toggleSplit() {
        const {layout} = presetFor(this._settings, global.workspace_manager.get_active_workspace_index() + 1);
        if (!isTilingLayout(layout))
            return;
        this._setLayout(layout === 'stacked' ? 'side-by-side' : 'stacked');
    }

    // --- Resizing -----------------------------------------------------------------------

    _resize(window, dx, dy) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL || !window.allows_resize())
            return;
        if (this._tiler.isTiled(window)) {
            this._tiler.resizeTiled(window, dx);
            return;
        }
        if (window.get_maximize_flags() || window.is_fullscreen())
            return;
        const frame = window.get_frame_rect();
        const area = window.get_work_area_current_monitor();
        const width = Math.min(area.width, Math.max(MIN_SIZE, frame.width + dx));
        const height = Math.min(area.height, Math.max(MIN_SIZE, frame.height + dy));
        // The right and bottom edges move; at the work area's edge the window moves back.
        const x = Math.max(area.x, Math.min(frame.x, area.x + area.width - width));
        const y = Math.max(area.y, Math.min(frame.y, area.y + area.height - height));
        window.move_resize_frame(true, x, y, width, height);
    }

    _restoreWidth(window) {
        const width = window && this._widths.get(window);
        if (width)
            this._resize(window, width - window.get_frame_rect().width, 0);
    }

    // --- Scratchpad -----------------------------------------------------------------------

    // Windows on the scratchpad are minimized while it is hidden. Showing it brings them
    // to the current workspace and monitor, floating above the rest.
    _toggleScratchpad() {
        const windows = this._tiler.scratchWindows();
        if (!windows.length)
            return;
        const workspace = global.workspace_manager.get_active_workspace();
        const shown = windows.some(w => !w.minimized && w.located_on_workspace(workspace));
        if (shown) {
            windows.forEach(w => w.minimize());
            return;
        }
        const monitor = global.display.get_current_monitor();
        const area = workspace.get_work_area_for_monitor(monitor);
        for (const window of windows) {
            if (window.get_workspace() !== workspace && !window.is_on_all_workspaces())
                window.change_workspace(workspace);
            if (window.get_monitor() !== monitor)
                window.move_to_monitor(monitor);
            window.unminimize();
            const frame = window.get_frame_rect();
            const width = Math.min(frame.width, area.width);
            const height = Math.min(frame.height, area.height);
            window.move_resize_frame(false, area.x + Math.round((area.width - width) / 2),
                area.y + Math.round((area.height - height) / 2), width, height);
        }
        windows[windows.length - 1].activate(global.get_current_time());
    }

    _toScratchpad(window) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        if (this._tiler.isScratch(window)) {
            this._tiler.setScratch(window, false);
            window.unmake_above();
            return;
        }
        if (window.get_maximize_flags())
            window.unmaximize();
        this._tiler.setScratch(window, true);
        window.make_above();
        window.minimize();
    }
}
