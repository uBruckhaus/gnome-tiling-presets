// Some options are GNOME's own settings (title bar buttons, title bar double-click, and
// GNOME shortcuts on the keys of switched-on Omarchy shortcuts). They are set while the
// extension runs; the user's own values are kept in `saved-gnome-settings` and put back
// when an option is turned off or the extension is disabled (also when the screen locks;
// unlocking sets them again). Kept on disk, so after a crash the next start still knows
// the user's values. If the user changes one of these settings elsewhere while the
// extension runs, that change is kept and becomes the value restored later.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readJSON, writeJSON} from './config.js';
import {WM_PREFS, savedId, splitSavedId} from './keys.js';

const BUTTONS = ['minimize', 'maximize', 'close'];

export class GnomeOverrides {
    constructor(settings) {
        this._settings = settings;
        this._schemas = new Map();   // schema id -> {settings, changedId}
        this._written = new Map();   // saved id -> value this extension wrote
    }

    destroy() {
        for (const {settings, changedId} of this._schemas.values())
            settings.disconnect(changedId);
        this._schemas.clear();
        this._written.clear();
    }

    // The Gio.Settings of a GNOME schema, or null when this GNOME does not have it.
    _gnome(schema) {
        let entry = this._schemas.get(schema);
        if (!entry) {
            if (!Gio.SettingsSchemaSource.get_default()?.lookup(schema, true))
                return null;
            const settings = new Gio.Settings({schema_id: schema});
            const changedId = settings.connect('changed', (_s, key) => this._onChanged(schema, key));
            entry = {settings, changedId};
            this._schemas.set(schema, entry);
        }
        return entry.settings;
    }

    // A change that is not this extension's own: the user's new choice wins.
    _onChanged(schema, key) {
        const id = savedId(schema, key);
        const written = this._written.get(id);
        if (!written || this._gnome(schema).get_value(key).equal(written))
            return;
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        if (id in saved) {
            delete saved[id];
            writeJSON(this._settings, 'saved-gnome-settings', saved);
        }
        this._written.delete(id);
    }

    // The user's own value of a key: the saved one while it is overridden.
    original(key, schema = WM_PREFS) {
        const saved = readJSON(this._settings, 'saved-gnome-settings')[savedId(schema, key)];
        if (saved !== undefined) {
            try {
                return GLib.Variant.parse(null, saved, null, null);
            } catch {}
        }
        return this._gnome(schema)?.get_value(key) ?? null;
    }

    // The value GNOME has now, or null when this GNOME does not have the schema.
    current(key, schema = WM_PREFS) {
        return this._gnome(schema)?.get_value(key) ?? null;
    }

    set(key, value, schema = WM_PREFS) {
        const gnome = this._gnome(schema);
        if (!gnome)
            return;
        const id = savedId(schema, key);
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        if (!(id in saved)) {
            saved[id] = gnome.get_value(key).print(true);
            writeJSON(this._settings, 'saved-gnome-settings', saved);
        }
        this._written.set(id, value);
        if (!gnome.get_value(key).equal(value))
            gnome.set_value(key, value);
    }

    release(key, schema = WM_PREFS) {
        const id = savedId(schema, key);
        const saved = readJSON(this._settings, 'saved-gnome-settings');
        this._written.delete(id);
        if (!(id in saved))
            return;
        const gnome = this._gnome(schema);
        if (gnome) {
            try {
                gnome.set_value(key, GLib.Variant.parse(null, saved[id], null, null));
            } catch {
                gnome.reset(key);
            }
        }
        delete saved[id];
        writeJSON(this._settings, 'saved-gnome-settings', saved);
    }

    // Sets a key, or releases it when the value is the user's own anyway.
    setOrRelease(key, value, schema = WM_PREFS) {
        const original = this.original(key, schema);
        if (original && original.equal(value))
            this.release(key, schema);
        else
            this.set(key, value, schema);
    }

    releaseAll() {
        for (const id of Object.keys(readJSON(this._settings, 'saved-gnome-settings'))) {
            const [schema, key] = splitSavedId(id);
            this.release(key, schema);
        }
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
