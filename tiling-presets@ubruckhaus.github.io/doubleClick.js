// A double-click on a window's title bar: on a tiled workspace the window floats (or
// tiles again); elsewhere it is maximized or restored, as GNOME does.
//
// On Wayland the shell never sees clicks inside windows, but apps hand title bar
// double-clicks to GNOME, which runs its "action-double-click-titlebar" setting. That is
// set to "toggle-maximize-vertically", which nothing else uses, and recognised here:
// - full height, same x and width: a double-click on a normal window;
// - maximized horizontally only: a double-click on a maximized window;
// - full height with a new x or width: edge tiling (Super+Left/Right), left alone.
// Floating windows are "Always on Top", which the tiler leaves out of its layouts and
// which keeps them above the tiled windows.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {presetFor} from './config.js';
import {isTilingLayout} from './layouts.js';

const SETTLE = 300;        // ms to wait for the new size when deciding what a maximize was
const HEADER_HEIGHT = 48;  // px from the top of a window where the pointer must be
const SHORTCUT_MODIFIERS = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;

export class HeaderDoubleClick {
    constructor(settings, tiler) {
        this._settings = settings;
        this._tiler = tiler;
    }

    enable() {
        this._floatRects = new WeakMap();
        this._restoreRects = new WeakMap();  // size before maximizing, to restore it
        this._pending = new Map();           // window -> {ids, timeoutId}
        this._timeouts = new Set();
        this._tiler.maximizeHook = window => this._onMaximize(window);
        this._settingsId = this._settings.connect('changed::header-double-click', () => {
            if (!this._settings.get_boolean('header-double-click'))
                this._cancelAll();
        });
    }

    disable() {
        this._settings.disconnect(this._settingsId);
        this._tiler.maximizeHook = null;
        this._cancelAll();
    }

    _cancelAll() {
        for (const window of [...this._pending.keys()])
            this._stopWaiting(window);
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
    }

    get _active() {
        return this._tiler.maximizeHook !== null && this._settings.get_boolean('header-double-click');
    }

    // A title bar double-click happens with the pointer on the title bar and no modifier
    // key held; a keyboard shortcut (maximize vertically or horizontally) needs one.
    _pointerOnHeader(window) {
        const [x, y, mods] = global.get_pointer();
        if (mods & SHORTCUT_MODIFIERS)
            return false;
        const frame = window.get_frame_rect();
        return x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + HEADER_HEIGHT;
    }

    // Runs `callback` later, unless the option was turned off or the window closed.
    _later(window, delay, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.delete(id);
            if (this._active && this._tiler.isTracked(window))
                callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    // Called by the tiler when a window's maximize state changes; true means the
    // tiler should not rearrange for it.
    _onMaximize(window) {
        if (!this._active)
            return false;
        if (this._pending.has(window))
            return true;
        const flags = window.get_maximize_flags();
        // The frame still has its old size when the flags change; remember it.
        if (flags === 0)
            this._restoreRects.delete(window);
        else if (flags === Meta.MaximizeFlags.BOTH && !this._restoreRects.has(window))
            this._restoreRects.set(window, window.get_frame_rect());
        if ((flags === Meta.MaximizeFlags.HORIZONTAL || flags === Meta.MaximizeFlags.VERTICAL) &&
            !this._pointerOnHeader(window))
            return false;
        if (flags === Meta.MaximizeFlags.HORIZONTAL) {
            // A double-click on a maximized window. GNOME loses the size to restore on
            // the way through "maximized horizontally", so it is put back from here.
            const rect = this._restoreRects.get(window);
            this._restoreRects.delete(window);
            this._later(window, 0, () => {
                window.unmaximize();
                if (rect)
                    this._later(window, 0, () => window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height));
            });
            return true;
        }
        if (flags !== Meta.MaximizeFlags.VERTICAL)
            return false;

        // The frame still has the old size here; the new one follows.
        const before = window.get_frame_rect();
        const decide = () => {
            if (!this._pending.has(window))
                return;
            this._stopWaiting(window);
            const frame = window.get_frame_rect();
            if (window.get_maximize_flags() !== Meta.MaximizeFlags.VERTICAL ||
                frame.x !== before.x || frame.width !== before.width) {
                this._tiler.requeue(window);    // edge tiling or something else
                return;
            }
            this._onDoubleClick(window, before);
        };
        const pending = {ids: [], timeoutId: 0};
        this._pending.set(window, pending);
        pending.ids.push(window.connect('size-changed', () => this._later(window, 0, decide)));
        pending.ids.push(window.connect('unmanaged', () => this._stopWaiting(window)));
        pending.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE, () => {
            pending.timeoutId = 0;
            decide();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _stopWaiting(window) {
        const pending = this._pending.get(window);
        if (!pending)
            return;
        this._pending.delete(window);
        pending.ids.forEach(id => window.disconnect(id));
        if (pending.timeoutId)
            GLib.source_remove(pending.timeoutId);
    }

    _onDoubleClick(window, before) {
        const workspace = window.get_workspace();
        if (!workspace)
            return;
        const tiling = !this._tiler.paused &&
            isTilingLayout(presetFor(this._settings, workspace.index() + 1).layout);
        if (tiling) {
            window.unmaximize();
            this._toggleFloating(window, workspace);
        } else {
            this._restoreRects.set(window, before);
            window.set_maximize_flags(Meta.MaximizeFlags.HORIZONTAL);
        }
    }

    _toggleFloating(window, workspace) {
        if (window.is_above()) {
            const frame = window.get_frame_rect();
            this._floatRects.set(window, {x: frame.x, y: frame.y, width: frame.width, height: frame.height});
            window.unmake_above();
            return;
        }
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
}
