// A coloured border around the focused window.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

const SWITCH_HIDE = 300;  // ms; hidden while a workspace switch animates
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;
const DEFAULT_COLOR = '#3584e4';
const BORDERED_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

export class FocusBorder {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._border = new St.Bin({style_class: 'tp-focus-border', reactive: false, visible: false});
        global.window_group.add_child(this._border);
        this._window = null;
        this._windowIds = [];
        this._switchId = 0;
        this._signals = [
            [global.display, global.display.connect('notify::focus-window', () => this._track())],
            [global.display, global.display.connect('restacked', () => this._restack())],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', () => this._hideForSwitch())],
            [this._settings, this._settings.connect('changed', (_s, key) => {
                if (key.startsWith('focus-border')) {
                    this._style();
                    this._update();
                }
            })],
        ];
        this._style();
        this._track();
    }

    disable() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._untrack();
        if (this._switchId)
            GLib.source_remove(this._switchId);
        this._switchId = 0;
        this._border.destroy();
        this._border = null;
    }

    _untrack() {
        for (const id of this._windowIds)
            this._window.disconnect(id);
        this._windowIds = [];
        this._window = null;
    }

    _track() {
        this._untrack();
        const window = global.display.focus_window;
        if (window) {
            this._window = window;
            const update = () => this._update();
            this._windowIds = ['position-changed', 'size-changed', 'workspace-changed',
                'notify::minimized', 'notify::fullscreen',
                'notify::maximized-horizontally', 'notify::maximized-vertically',
            ].map(signal => window.connect(signal, update));
            this._windowIds.push(window.connect('unmanaged', () => {
                this._untrack();
                this._update();
            }));
        }
        this._update();
    }

    _style() {
        const width = this._settings.get_int('focus-border-width');
        const radius = this._settings.get_int('focus-border-radius');
        let color = this._settings.get_string('focus-border-color');
        if (!COLOR.test(color))
            color = DEFAULT_COLOR;
        this._border.style = `border: ${width}px solid ${color}; border-radius: ${radius ? radius + width : 0}px;`;
    }

    _hideForSwitch() {
        if (this._switchId)
            GLib.source_remove(this._switchId);
        this._switchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SWITCH_HIDE, () => {
            this._switchId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
        this._update();
    }

    _update() {
        const window = this._window;
        const show = this._settings.get_boolean('focus-border') && window && !this._switchId &&
            BORDERED_TYPES.includes(window.get_window_type()) &&
            !window.minimized && !window.is_fullscreen() &&
            window.get_maximize_flags() !== Meta.MaximizeFlags.BOTH &&
            window.located_on_workspace(global.workspace_manager.get_active_workspace());
        if (!show) {
            this._border.hide();
            return;
        }
        const width = this._settings.get_int('focus-border-width');
        const frame = window.get_frame_rect();
        this._border.set_position(frame.x - width, frame.y - width);
        this._border.set_size(frame.width + 2 * width, frame.height + 2 * width);
        this._border.show();
        this._restack();
    }

    _restack() {
        const actor = this._window?.get_compositor_private();
        if (actor && actor.get_parent() === global.window_group)
            global.window_group.set_child_above_sibling(this._border, actor);
    }
}
