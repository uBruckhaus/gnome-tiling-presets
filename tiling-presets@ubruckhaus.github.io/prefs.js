import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _, ngettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {appPresets, readJSON, setAppPreset, setWorkspacePreset} from './config.js';
import {ALREADY_IN_GNOME, GROUPS, NOT_IN_GNOME, gnomeKeybindings, keyNameLabel, rowKeysLabel, takenBy} from './keys.js';
import {LAYOUTS, LIMITS} from './layouts.js';

function layoutNames() {
    return {
        'floating': _('Floating'),
        'auto': _('Auto'),
        'side-by-side': _('Side by side'),
        'stacked': _('Stacked'),
        'master-left': _('Master left'),
        'master-right': _('Master right'),
        'columns': _('Columns'),
        'grid': _('Grid'),
    };
}

function limitName(limit) {
    return limit ? ngettext('%d window', '%d windows', limit).format(limit) : _('No limit');
}

// A combo row bound to a string or int key, listing `values` with their labels.
function choiceRow(settings, key, title, subtitle, values, labels) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(labels),
    });
    const isInt = typeof values[0] === 'number';
    const read = () => (isInt ? settings.get_int(key) : settings.get_string(key));
    const sync = () => {
        row.selected = Math.max(0, values.indexOf(read()));
    };
    sync();
    row.connect('notify::selected', () => {
        const value = values[row.selected];
        if (value === read())
            return;
        if (isInt)
            settings.set_int(key, value);
        else
            settings.set_string(key, value);
    });
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

function deleteButton(tooltip, callback) {
    const button = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: tooltip,
        css_classes: ['flat'],
    });
    button.connect('clicked', callback);
    return button;
}

// A switch row bound to a boolean key.
function switchRow(settings, key, title, subtitle = null) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step = 1) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class TilingPresetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(720, 860);
        const names = layoutNames();

        // --- Tiling ----------------------------------------------------------------
        const tilingPage = new Adw.PreferencesPage({title: _('Tiling'), icon_name: 'view-grid-symbolic'});
        window.add(tilingPage);

        const main = new Adw.PreferencesGroup();
        const tiling = new Adw.SwitchRow({
            title: _('Tiling'),
            subtitle: _('Arrange windows in their workspace\'s layout and move new windows on when a workspace is full. Also with a right-click on the top-bar button.'),
        });
        settings.bind('paused', tiling, 'active', Gio.SettingsBindFlags.INVERT_BOOLEAN);
        main.add(tiling);
        tilingPage.add(main);

        const defaults = new Adw.PreferencesGroup({
            title: _('Default preset'),
            description: _('For every workspace without a preset of its own. Floating leaves windows as GNOME places them.'),
        });
        defaults.add(choiceRow(settings, 'default-layout', _('Layout'), null,
            LAYOUTS, LAYOUTS.map(l => names[l])));
        defaults.add(choiceRow(settings, 'default-limit', _('Window limit'),
            _('New windows that do not fit move on to the next workspace with room.'),
            LIMITS, LIMITS.map(limitName)));
        tilingPage.add(defaults);

        const behaviour = new Adw.PreferencesGroup({title: _('Behaviour')});
        behaviour.add(spinRow(settings, 'gap', _('Gap'),
            _('Space around and between tiled windows, in pixels'), 0, 48, 2));
        behaviour.add(switchRow(settings, 'follow-overflow', _('Follow moved windows'),
            _('Switch to the workspace a new window was moved to')));
        behaviour.add(switchRow(settings, 'header-double-click', _('Double-click on the title bar floats'),
            _('On tiled workspaces a double-click with the left button floats the window or tiles it again. Elsewhere it maximizes, as in GNOME.')));
        behaviour.add(choiceRow(settings, 'restore-conflicts', _('Other windows when restoring'),
            _('What restoring an App Preset does with windows that are not part of it'),
            ['move', 'keep', 'close'],
            [_('Move them on'), _('Keep them'), _('Close them')]));
        tilingPage.add(behaviour);

        // --- Windows ---------------------------------------------------------------
        const windowsPage = new Adw.PreferencesPage({title: _('Windows'), icon_name: 'focus-windows-symbolic'});
        window.add(windowsPage);

        const border = new Adw.PreferencesGroup({
            title: _('Active window border'),
            description: _('A border in GNOME\'s accent colour around the window that has the focus. Not shown on maximized and fullscreen windows.'),
        });
        const showBorder = switchRow(settings, 'focus-border', _('Show a border'));
        border.add(showBorder);
        const borderRows = [
            spinRow(settings, 'focus-border-width', _('Thickness'), _('In pixels'), 1, 12),
            spinRow(settings, 'focus-border-radius', _('Corner radius'),
                _('In pixels; 12 matches GNOME\'s rounded windows, 0 is square'), 0, 24),
        ];
        for (const row of borderRows) {
            settings.bind('focus-border', row, 'sensitive', Gio.SettingsBindFlags.GET);
            border.add(row);
        }
        windowsPage.add(border);

        const buttons = new Adw.PreferencesGroup({
            title: _('Title bar buttons'),
            description: _('Which buttons windows show in their title bar. Turning the extension off brings back your own GNOME setting.'),
        });
        buttons.add(switchRow(settings, 'show-minimize-button', _('Minimize')));
        buttons.add(switchRow(settings, 'show-maximize-button', _('Maximize')));
        buttons.add(switchRow(settings, 'show-close-button', _('Close')));
        windowsPage.add(buttons);

        // --- Workspaces ------------------------------------------------------------
        const workspacesPage = new Adw.PreferencesPage({title: _('Workspaces'), icon_name: 'view-app-grid-symbolic'});
        window.add(workspacesPage);

        const numbers = new Adw.PreferencesGroup({
            title: _('Workspace numbers'),
            description: _('Numbers in the top bar like on Omarchy: the active workspace is highlighted, empty ones are dimmed. Click a number to switch, scroll to move along.'),
        });
        numbers.add(switchRow(settings, 'show-workspace-numbers', _('Show workspace numbers')));
        const minimum = spinRow(settings, 'workspace-numbers-minimum', _('Always shown'),
            _('More numbers appear when those workspaces are in use'), 1, 10);
        settings.bind('show-workspace-numbers', minimum, 'sensitive', Gio.SettingsBindFlags.GET);
        numbers.add(minimum);
        workspacesPage.add(numbers);

        // GNOME's own workspace settings (also in Settings → Multitasking): with dynamic
        // workspaces GNOME removes empty ones and renumbers the rest.
        const gnome = new Adw.PreferencesGroup({
            title: _('GNOME workspaces'),
            description: _('GNOME\'s own settings, also in Settings → Multitasking. With a fixed number, empty workspaces stay, so numbers keep their place.'),
        });
        const mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        const wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        window._gnomeSettings = [mutter, wm];
        const fixed = new Adw.SwitchRow({title: _('Fixed number of workspaces')});
        mutter.bind('dynamic-workspaces', fixed, 'active', Gio.SettingsBindFlags.INVERT_BOOLEAN);
        gnome.add(fixed);
        const count = spinRow(wm, 'num-workspaces', _('Number of workspaces'), null, 1, 36);
        fixed.bind_property('active', count, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        gnome.add(count);
        workspacesPage.add(gnome);

        // --- Shortcuts -------------------------------------------------------------
        const shortcutsPage = this._shortcutsPage(settings);
        window.add(shortcutsPage);

        // --- Presets ---------------------------------------------------------------
        // Workspace presets and App Presets are rebuilt whenever they change.
        const presetsPage = new Adw.PreferencesPage({title: _('Presets'), icon_name: 'document-save-symbolic'});
        window.add(presetsPage);
        let workspaceGroup = null;
        let appGroup = null;
        const rebuild = () => {
            if (workspaceGroup)
                presetsPage.remove(workspaceGroup);
            if (appGroup)
                presetsPage.remove(appGroup);
            workspaceGroup = this._workspaceGroup(settings, names);
            appGroup = this._appGroup(settings);
            presetsPage.add(workspaceGroup);
            presetsPage.add(appGroup);
        };
        rebuild();
        const ids = [
            settings.connect('changed::workspace-presets', rebuild),
            settings.connect('changed::app-presets', rebuild),
        ];
        window.connect('close-request', () => {
            ids.forEach(id => settings.disconnect(id));
            return false;
        });
    }

    // The active keyboard layout as GTK sees it: key codes of a key name, and what a key
    // code types (shortcuts bound by their place show the user's own characters).
    _layout(keyboard) {
        const display = Gdk.Display.get_default();
        const group = keyboard?.active_layout_index ?? 0;
        const resolve = name => {
            const keyval = Gdk.keyval_from_name(name);
            if (!keyval || keyval === Gdk.KEY_VoidSymbol)
                return null;
            const [found, keys] = display.map_keyval(keyval);
            return found ? [...new Set(keys.filter(key => key.group === group).map(key => key.keycode))] : [];
        };
        const codeLabel = code => {
            const [found, keys, keyvals] = display.map_keycode(code);
            const index = found ? keys.findIndex(key => key.level === 0 && key.group === group) : -1;
            return index < 0 ? null : keyNameLabel(Gdk.keyval_name(keyvals[index]));
        };
        return {resolve, codeLabel};
    }

    // Omarchy's navigation shortcuts, each with a switch. The keys are a label, so the
    // switch stays at the right end of the row.
    _shortcutsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Shortcuts'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        const keys = this.getSettings('org.gnome.shell.extensions.tiling-presets.keybindings');
        const accelsOf = name => keys.get_strv(name);
        const gnome = gnomeKeybindings(readJSON(settings, 'saved-gnome-settings'));
        const summaryOf = (schema, key) => gnome.find(g => g.schema === schema && g.key === key)?.summary ?? key;

        const intro = new Adw.PreferencesGroup({
            description: _('Omarchy\'s navigation shortcuts that GNOME does not have on these keys. While one is on, ' +
                'a GNOME shortcut on the same keys gives them up; it gets them back when you switch it off ' +
                'or turn the extension off.'),
        });
        page.add(intro);

        const switches = new Map();
        const enabled = () => new Set(settings.get_strv('shortcuts'));
        // The subtitle and keys of a row depend on the keyboard layout.
        const describe = (row, {resolve, codeLabel}) => {
            const lines = row.subtitle ? [_(row.subtitle)] : [];
            const targets = Object.values(row.gnome ?? {});
            if (targets.length)
                lines.push(_('GNOME\'s own “%s”').format(summaryOf(...targets[0]).replace(/\s+\d+$/, '')));
            // "Switch to application 1 … 9" is one GNOME shortcut to the reader.
            const taken = [...new Set(takenBy(row, accelsOf, gnome, resolve).map(t => t.summary.replace(/\s+\d+$/, '')))];
            if (taken.length) {
                const names = taken.slice(0, 2).map(t => `“${t}”`).join(', ');
                lines.push(taken.length > 2
                    ? _('Instead of GNOME\'s %s and %d more').format(names, taken.length - 2)
                    : _('Instead of GNOME\'s %s').format(names));
            }
            if (row.setting)
                lines.push(_('Changes GNOME\'s own window setting'));
            return {subtitle: lines.join('\n'), keys: rowKeysLabel(row, accelsOf, codeLabel)};
        };
        const shown = [];   // [row, action row, keys label]
        for (const group of GROUPS) {
            const prefsGroup = new Adw.PreferencesGroup({title: _(group.title), description: group.description ?? null});
            for (const row of group.rows) {
                const actionRow = new Adw.ActionRow({title: _(row.title), use_markup: false});
                const keysLabel = new Gtk.Label({css_classes: ['dim-label'], valign: Gtk.Align.CENTER});
                actionRow.add_suffix(keysLabel);
                shown.push([row, actionRow, keysLabel]);
                const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: enabled().has(row.id)});
                toggle.connect('notify::active', () => {
                    const ids = enabled();
                    if (toggle.active === ids.has(row.id))
                        return;
                    if (toggle.active)
                        ids.add(row.id);
                    else
                        ids.delete(row.id);
                    settings.set_strv('shortcuts', [...ids]);
                });
                actionRow.add_suffix(toggle);
                actionRow.activatable_widget = toggle;
                switches.set(row.id, toggle);
                prefsGroup.add(actionRow);
            }
            page.add(prefsGroup);
        }
        const id = settings.connect('changed::shortcuts', () => {
            const ids = enabled();
            for (const [rowId, toggle] of switches)
                toggle.active = ids.has(rowId);
        });

        // GTK learns the real keyboard layout a moment after the window opens, and the user
        // may switch layouts; both update the keys and what they take from GNOME.
        const keyboard = Gdk.Display.get_default()?.get_default_seat()?.get_keyboard() ?? null;
        const refresh = () => {
            const layout = this._layout(keyboard);
            for (const [row, actionRow, keysLabel] of shown) {
                const {subtitle, keys: label} = describe(row, layout);
                actionRow.subtitle = subtitle;
                keysLabel.label = label;
            }
        };
        refresh();
        const keyboardIds = keyboard ? ['notify::layout-names', 'notify::active-layout-index']
            .map(signal => keyboard.connect(signal, refresh)) : [];
        page.connect('destroy', () => {
            settings.disconnect(id);
            keyboardIds.forEach(keyboardId => keyboard.disconnect(keyboardId));
        });

        const infoGroup = (title, description, rows) => {
            const group = new Adw.PreferencesGroup({title, description});
            for (const row of rows) {
                const actionRow = new Adw.ActionRow({title: _(row.title), subtitle: row.reason ? _(row.reason) : '', use_markup: false});
                actionRow.add_suffix(new Gtk.Label({label: row.keys, css_classes: ['dim-label'], valign: Gtk.Align.CENTER}));
                group.add(actionRow);
            }
            return group;
        };
        page.add(infoGroup(_('Already in GNOME'), _('Nothing to switch on.'), ALREADY_IN_GNOME));
        page.add(infoGroup(_('Not available in GNOME'), null, NOT_IN_GNOME));
        return page;
    }

    _workspaceGroup(settings, names) {
        const group = new Adw.PreferencesGroup({
            title: _('Workspace presets'),
            description: _('Set from the top-bar menu on each workspace.'),
        });
        const presets = Object.entries(readJSON(settings, 'workspace-presets'))
            .sort(([a], [b]) => Number(a) - Number(b));
        if (!presets.length) {
            group.add(new Adw.ActionRow({title: _('No workspace has a preset of its own yet.')}));
            return group;
        }
        for (const [number, preset] of presets) {
            const subtitle = preset.layout === 'floating' ? names.floating
                : `${names[preset.layout] ?? preset.layout} · ${limitName(preset.limit)}`;
            const row = new Adw.ActionRow({title: _('Workspace %d').format(Number(number)), subtitle});
            row.add_suffix(deleteButton(_('Use the default preset'),
                () => setWorkspacePreset(settings, number, null)));
            group.add(row);
        }
        const clear = new Gtk.Button({label: _('Remove all'), valign: Gtk.Align.CENTER, css_classes: ['flat']});
        clear.connect('clicked', () => settings.set_string('workspace-presets', '{}'));
        group.set_header_suffix(clear);
        return group;
    }

    _appGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('App Presets'),
            description: _('Saved from the top-bar menu. Restore at login runs once after you log in.'),
        });
        const presets = Object.entries(appPresets(settings))
            .sort(([a], [b]) => Number(a) - Number(b));
        if (!presets.length) {
            group.add(new Adw.ActionRow({title: _('No App Presets saved yet.')}));
            return group;
        }
        for (const [number, data] of presets) {
            const apps = (data.apps ?? []).map(app => app.name).join(', ');
            const row = new Adw.ExpanderRow({
                title: _('Workspace %d').format(Number(number)),
                subtitle: apps,
            });
            const login = new Adw.SwitchRow({title: _('Restore at login'), active: Boolean(data.autostart)});
            login.connect('notify::active', () => {
                const current = appPresets(settings)[number];
                if (current && Boolean(current.autostart) !== login.active)
                    setAppPreset(settings, number, {...current, autostart: login.active});
            });
            row.add_row(login);
            if (data.saved)
                row.add_row(new Adw.ActionRow({title: _('Saved'), subtitle: data.saved}));
            row.add_suffix(deleteButton(_('Delete App Preset'),
                () => setAppPreset(settings, number, null)));
            group.add(row);
        }
        return group;
    }
}
