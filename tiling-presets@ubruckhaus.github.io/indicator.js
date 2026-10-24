// The top-bar button: shows the current workspace's layout and opens the presets menu.
// Right-click switches tiling off or on.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {presetFor, setWorkspacePreset} from './config.js';
import {LAYOUTS, LIMITS, isTilingLayout} from './layouts.js';

export function layoutName(layout) {
    return {
        'floating': _('Floating'),
        'auto': _('Auto'),
        'side-by-side': _('Side by side'),
        'stacked': _('Stacked'),
        'master-left': _('Master left'),
        'master-right': _('Master right'),
        'columns': _('Columns'),
        'grid': _('Grid'),
    }[layout] ?? layout;
}

export const Indicator = GObject.registerClass(
class TilingPresetsIndicator extends PanelMenu.Button {
    _init(extension, tiler, appPresets) {
        super._init(0.5, _('Tiling Presets'));
        this._extension = extension;
        this._settings = extension.getSettings();
        this._tiler = tiler;
        this._appPresets = appPresets;

        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);

        // Left click opens the menu, right click switches tiling (the panel button reacts to any button).
        this._clickGesture?.set_required_button?.(Clutter.BUTTON_PRIMARY);
        const pauseGesture = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        pauseGesture.connect('recognize', () => this._togglePause());
        this.add_action(pauseGesture);

        this._settingsId = this._settings.connect('changed', () => {
            this._updateIcon();
            if (this.menu.isOpen)
                this._buildMenu();
        });
        this._workspaceId = global.workspace_manager.connect('active-workspace-changed', () => {
            this._updateIcon();
            this._buildMenu();
        });
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._buildMenu();
        });
        this._updateIcon();
        // A popup menu without items does not open, so it is filled from the start.
        this._buildMenu();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        global.workspace_manager.disconnect(this._workspaceId);
        super.destroy();
    }

    _iconFor(name) {
        return Gio.FileIcon.new(this._extension.dir.resolve_relative_path(`icons/${name}-symbolic.svg`));
    }

    get _index() {
        return global.workspace_manager.get_active_workspace_index();
    }

    _updateIcon() {
        const paused = this._settings.get_boolean('paused');
        const {layout} = presetFor(this._settings, this._index + 1);
        this._icon.gicon = this._iconFor(paused ? 'paused' : `layout-${layout}`);
        this.accessible_name = paused ? _('Tiling Presets (tiling off)')
            : `${_('Tiling Presets')}: ${layoutName(layout)}`;
    }

    _togglePause() {
        this._settings.set_boolean('paused', !this._settings.get_boolean('paused'));
    }

    _setPreset(change) {
        const number = this._index + 1;
        const {layout, limit} = presetFor(this._settings, number);
        setWorkspacePreset(this._settings, number, {layout, limit, ...change});
    }

    _buildMenu() {
        this.menu.removeAll();
        const index = this._index;
        const number = index + 1;
        const preset = presetFor(this._settings, number);

        const header = new PopupMenu.PopupMenuItem(
            preset.own ? _('Workspace %d').format(number)
                : _('Workspace %d · default preset').format(number),
            {activate: false, hover: false, can_focus: false});
        header.label.add_style_class_name('tp-header');
        this.menu.addMenuItem(header);

        // Layout buttons, four to a row.
        const layoutItem = new PopupMenu.PopupBaseMenuItem({activate: false, hover: false, can_focus: false});
        const rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'tp-rows', x_expand: true});
        for (let start = 0; start < LAYOUTS.length; start += 4) {
            const row = new St.BoxLayout({style_class: 'tp-row', x_expand: true});
            for (const layout of LAYOUTS.slice(start, start + 4)) {
                const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.CENTER});
                box.add_child(new St.Icon({gicon: this._iconFor(`layout-${layout}`), style_class: 'tp-layout-icon'}));
                box.add_child(new St.Label({text: layoutName(layout), style_class: 'tp-layout-label', x_align: Clutter.ActorAlign.CENTER}));
                const button = new St.Button({
                    child: box,
                    style_class: 'tp-button tp-layout-button',
                    can_focus: true,
                    x_expand: true,
                    accessible_name: layoutName(layout),
                });
                if (layout === preset.layout)
                    button.add_style_pseudo_class('checked');
                button.connect('clicked', () => this._setPreset({layout}));
                row.add_child(button);
            }
            rows.add_child(row);
        }
        layoutItem.add_child(rows);
        this.menu.addMenuItem(layoutItem);

        // Window limit.
        const limitItem = new PopupMenu.PopupBaseMenuItem({activate: false, hover: false, can_focus: false});
        limitItem.add_child(new St.Label({text: _('Window limit'), y_align: Clutter.ActorAlign.CENTER, x_expand: true}));
        const tiling = isTilingLayout(preset.layout);
        for (const limit of LIMITS) {
            const button = new St.Button({
                label: limit ? String(limit) : '∞',
                style_class: 'tp-button tp-limit-button',
                can_focus: tiling,
                reactive: tiling,
                accessible_name: limit ? ngettext('%d window', '%d windows', limit).format(limit) : _('No limit'),
            });
            if (tiling && limit === preset.limit)
                button.add_style_pseudo_class('checked');
            if (!tiling)
                button.add_style_pseudo_class('insensitive');
            button.connect('clicked', () => this._setPreset({limit}));
            limitItem.add_child(button);
        }
        this.menu.addMenuItem(limitItem);

        if (preset.own) {
            this.menu.addAction(_('Use the default preset'),
                () => setWorkspacePreset(this._settings, number, null));
        }

        // App Preset of this workspace.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('App Preset')));
        const data = this._appPresets.get(number);
        if (data) {
            const appsItem = new PopupMenu.PopupBaseMenuItem({activate: false, hover: false, can_focus: false});
            const apps = new St.BoxLayout({style_class: 'tp-apps'});
            for (const app of data.apps ?? []) {
                let gicon = null;
                try {
                    gicon = app.icon ? Gio.Icon.new_for_string(app.icon) : null;
                } catch {}
                apps.add_child(new St.Icon({
                    gicon: gicon ?? Gio.ThemedIcon.new('application-x-executable'),
                    style_class: 'tp-app-icon',
                    accessible_name: app.name,
                }));
            }
            appsItem.add_child(apps);
            appsItem.add_child(new St.Label({
                text: ngettext('%d window', '%d windows', data.windows.length).format(data.windows.length),
                style_class: 'tp-dim',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this.menu.addMenuItem(appsItem);

            this.menu.addAction(_('Restore'), () => this._appPresets.restore(index));
            const login = new PopupMenu.PopupSwitchMenuItem(_('Restore at login'), Boolean(data.autostart));
            login.connect('toggled', (_item, state) => this._appPresets.setAutostart(number, state));
            this.menu.addMenuItem(login);
            this.menu.addAction(_('Save again'), () => this._appPresets.save(index));
            this.menu.addAction(_('Delete App Preset'), () => this._appPresets.remove(number));
        } else {
            const save = this.menu.addAction(_('Save the apps on this workspace'),
                () => this._appPresets.save(index));
            const hasWindows = global.workspace_manager.get_workspace_by_index(index)
                .list_windows().some(w => !w.is_skip_taskbar() && !w.is_on_all_workspaces());
            save.setSensitive(hasWindows);
        }

        const count = Object.keys(this._appPresets.all()).length;
        if (count > 1 || (count === 1 && !data))
            this.menu.addAction(_('Restore all App Presets'), () => this._appPresets.restoreAll());

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const tilingSwitch = new PopupMenu.PopupSwitchMenuItem(_('Tiling'),
            !this._settings.get_boolean('paused'));
        tilingSwitch.connect('toggled', (_item, state) => this._settings.set_boolean('paused', !state));
        this.menu.addMenuItem(tilingSwitch);
        this.menu.addAction(_('Settings'), () => this._extension.openPreferences());
    }
});
