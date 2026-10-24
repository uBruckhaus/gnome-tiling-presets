// Some options are GNOME's own window settings (title bar buttons, title bar double-click).
// They are set while the extension runs; the user's own values are kept in
// `saved-gnome-settings` and put back when an option is turned off or the extension is
// disabled (also when the screen locks; unlocking sets them again). Kept on disk, so after
// a crash the next start still knows the user's values. If the user changes one of these
// settings elsewhere while the extension runs, that change is kept and becomes the value
// restored later.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readJSON, writeJSON} from './config.js';

const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';
const BUTTONS = ['minimize', 'maximize', 'close'];

export class GnomeOverrides {
    constructor(settings) {
        this._settings = settings;
        this._wm = new Gio.Settings({schema_id: WM_SCHEMA});
        this._written = new Map();   // key -> value this extension wrote
        this._changedId = this._wm.connect('changed', (_wm, key) => this._onChanged(key));
    }

    destroy() {
        this._wm.disconnect(this._changedId);
        this._written.clear();
    }

    // A change that is not this extension's own: the user's new choice wins.
    _onChanged(key) {
        const written = this._written.get(key);
        if (!written || this._wm.get_value(key).equal(written))
            return;
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        if (key in saved) {
            delete saved[key];
            writeJSON(this._settings, 'saved-gnome-settings', saved);
        }
        this._written.delete(key);
    }

    // The user's own value of a key: the saved one while it is overridden.
    original(key) {
        const saved = readJSON(this._settings, 'saved-gnome-settings')[key];
        if (saved !== undefined) {
            try {
                return GLib.Variant.parse(null, saved, null, null);
            } catch {}
        }
        return this._wm.get_value(key);
    }

    set(key, value) {
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        if (!(key in saved)) {
            saved[key] = this._wm.get_value(key).print(true);
            writeJSON(this._settings, 'saved-gnome-settings', saved);
        }
        this._written.set(key, value);
        if (!this._wm.get_value(key).equal(value))
            this._wm.set_value(key, value);
    }

    release(key) {
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        this._written.delete(key);
        if (!(key in saved))
            return;
        try {
            this._wm.set_value(key, GLib.Variant.parse(null, saved[key], null, null));
        } catch {
            this._wm.reset(key);
        }
        delete saved[key];
        writeJSON(this._settings, 'saved-gnome-settings', saved);
    }

    releaseAll() {
        for (const key of Object.keys(readJSON(this._settings, 'saved-gnome-settings')))
            this.release(key);
    }

    // Title bar buttons: the user's left side (for example "appmenu") stays, the right
    // side gets minimize, maximize and close as chosen.
    syncButtons() {
        const left = this.original('button-layout').unpack().split(':')[0];
        const right = BUTTONS.filter(button => this._settings.get_boolean(`show-${button}-button`));
        this.set('button-layout', new GLib.Variant('s', `${left}:${right.join(',')}`));
    }

    // Title bar double-clicks become a vertical maximize, which doubleClick.js recognises.
    syncDoubleClick() {
        if (this._settings.get_boolean('header-double-click'))
            this.set('action-double-click-titlebar', new GLib.Variant('s', 'toggle-maximize-vertically'));
        else
            this.release('action-double-click-titlebar');
    }
}
