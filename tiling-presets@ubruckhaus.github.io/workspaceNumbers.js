// Workspace numbers in the top bar, as on Omarchy: at least the first few are always
// shown, more appear when they are in use. Empty ones are dimmed, the active one is
// highlighted. A click switches to a workspace, the scroll wheel moves along them.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

function hasAppWindows(workspace) {
    return workspace.list_windows().some(window =>
        window.get_window_type() === Meta.WindowType.NORMAL &&
        !window.is_skip_taskbar() && !window.is_on_all_workspaces());
}

export const WorkspaceNumbers = GObject.registerClass(
class TilingPresetsWorkspaceNumbers extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, _('Workspaces'), true);
        this._settings = settings;
        this.track_hover = false;
        this.add_style_class_name('tp-workspaces');
        this._box = new St.BoxLayout({style_class: 'tp-workspaces-box', y_expand: true});
        this.add_child(this._box);

        this._workspaceSignals = [];
        this._updateId = 0;
        const manager = global.workspace_manager;
        this._managerIds = ['workspace-added', 'workspace-removed', 'workspaces-reordered',
            'active-workspace-changed'].map(signal => manager.connect(signal, () => this._watch()));
        this._settingsId = settings.connect('changed::workspace-numbers-minimum', () => this._queue());
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._mutterId = this._mutter.connect('changed::dynamic-workspaces', () => this._queue());
        this._watch();
    }

    destroy() {
        const manager = global.workspace_manager;
        this._managerIds.forEach(id => manager.disconnect(id));
        this._settings.disconnect(this._settingsId);
        this._mutter.disconnect(this._mutterId);
        this._unwatchWorkspaces();
        if (this._updateId)
            GLib.source_remove(this._updateId);
        this._updateId = 0;
        super.destroy();
    }

    // The same wheel behaviour as GNOME's Activities button.
    vfunc_scroll_event(event) {
        return Main.wm.handleWorkspaceScroll(event);
    }

    _unwatchWorkspaces() {
        for (const [workspace, ids] of this._workspaceSignals)
            ids.forEach(id => workspace.disconnect(id));
        this._workspaceSignals = [];
    }

    // Windows coming and going change which numbers are dimmed and how many are shown.
    _watch() {
        this._unwatchWorkspaces();
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            this._workspaceSignals.push([workspace, [
                workspace.connect('window-added', () => this._queue()),
                workspace.connect('window-removed', () => this._queue()),
            ]]);
        }
        this._update();
    }

    _queue() {
        if (this._updateId)
            return;
        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _update() {
        const manager = global.workspace_manager;
        const active = manager.get_active_workspace_index();
        const used = [];
        for (let i = 0; i < manager.n_workspaces; i++)
            used.push(hasAppWindows(manager.get_workspace_by_index(i)));
        const lastUsed = used.lastIndexOf(true);
        let count = Math.max(this._settings.get_int('workspace-numbers-minimum'), lastUsed + 1, active + 1);
        // With a fixed number of workspaces only those exist; creating one would raise
        // GNOME's workspace count for good.
        if (!Meta.prefs_get_dynamic_workspaces())
            count = Math.min(count, manager.n_workspaces);

        this._box.destroy_all_children();
        for (let i = 0; i < count; i++) {
            // The button fills the bar's height, so a click on the screen's top edge counts.
            const button = new St.Button({
                child: new St.Label({
                    text: String(i + 1),
                    style_class: 'tp-ws-pill',
                    y_align: Clutter.ActorAlign.CENTER,
                }),
                style_class: 'tp-ws-button',
                can_focus: true,
                y_expand: true,
                accessible_name: _('Workspace %d').format(i + 1),
            });
            if (i === active)
                button.add_style_pseudo_class('checked');
            else if (!used[i])
                button.add_style_class_name('tp-ws-empty');
            button.connect('clicked', () => this._activate(i));
            this._box.add_child(button);
        }
    }

    // With dynamic workspaces, numbers past the last workspace create the workspaces up
    // to them; GNOME removes empty ones in between again and renumbers the rest.
    _activate(index) {
        const manager = global.workspace_manager;
        const time = global.get_current_time();
        if (index >= manager.n_workspaces && !Meta.prefs_get_dynamic_workspaces())
            return;
        while (manager.n_workspaces <= index)
            manager.append_new_workspace(false, time);
        manager.get_workspace_by_index(index).activate(time);
    }
});
