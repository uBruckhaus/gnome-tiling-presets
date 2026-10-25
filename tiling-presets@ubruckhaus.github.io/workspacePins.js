// Numbered workspaces, as on Omarchy: with dynamic workspaces GNOME removes every empty
// workspace but the last and renumbers the rest, so a window moved to workspace 5 ends up
// on 2. GNOME's keep-alive pins the workspaces up to the highest one in use (or active,
// or always shown in the top bar); only the empty ones after them are removed.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GLib timeouts take at most a signed 32-bit number of milliseconds (about 24 days);
// every update renews the pins.
const FOREVER = 2 ** 31 - 1;

function inUse(workspace) {
    return workspace.list_windows().some(window => !window.is_on_all_workspaces());
}

export class WorkspacePins {
    constructor(settings) {
        this._settings = settings;
        this._pinned = new Set();
        this._workspaceSignals = [];
    }

    enable() {
        const manager = global.workspace_manager;
        this._managerIds = ['workspace-added', 'workspace-removed', 'workspaces-reordered',
            'active-workspace-changed'].map(signal => manager.connect(signal, () => this._watch()));
        this._settingsIds = ['changed::workspace-numbers-minimum', 'changed::show-workspace-numbers']
            .map(signal => this._settings.connect(signal, () => this._watch()));
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._mutterId = this._mutter.connect('changed::dynamic-workspaces', () => this._watch());
        this._watch();
    }

    disable() {
        const manager = global.workspace_manager;
        this._managerIds.forEach(id => manager.disconnect(id));
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._mutter.disconnect(this._mutterId);
        this._mutter = null;
        this._unwatchWorkspaces();
        for (const workspace of this._pinned)
            this._release(workspace);
        this._pinned.clear();
    }

    _unwatchWorkspaces() {
        for (const [workspace, ids] of this._workspaceSignals)
            ids.forEach(id => workspace.disconnect(id));
        this._workspaceSignals = [];
    }

    // Updates right away, not later: GNOME checks for empty workspaces before the next
    // redraw, and the pins must be in place by then.
    _watch() {
        this._unwatchWorkspaces();
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            this._workspaceSignals.push([workspace, [
                workspace.connect('window-added', () => this._update()),
                workspace.connect('window-removed', () => this._update()),
            ]]);
        }
        this._update();
    }

    _update() {
        // Adding a workspace below comes back here through 'workspace-added'.
        if (this._updating)
            return;
        this._updating = true;
        try {
            this._pin();
        } finally {
            this._updating = false;
        }
    }

    _pin() {
        const manager = global.workspace_manager;
        const pinned = new Set();
        if (Meta.prefs_get_dynamic_workspaces()) {
            const minimum = this._settings.get_boolean('show-workspace-numbers')
                ? this._settings.get_int('workspace-numbers-minimum') : 1;
            // The numbers always shown exist, so Super + 5 and a click on 5 land there.
            while (manager.n_workspaces < minimum)
                manager.append_new_workspace(false, global.get_current_time());
            let count = Math.max(minimum, manager.get_active_workspace_index() + 1);
            for (let i = manager.n_workspaces - 1; i >= count; i--) {
                if (inUse(manager.get_workspace_by_index(i))) {
                    count = i + 1;
                    break;
                }
            }
            for (let i = 0; i < Math.min(count, manager.n_workspaces); i++)
                pinned.add(manager.get_workspace_by_index(i));
        }
        for (const workspace of this._pinned) {
            if (!pinned.has(workspace))
                this._release(workspace);
        }
        for (const workspace of pinned)
            Main.wm.keepWorkspaceAlive(workspace, FOREVER);
        this._pinned = pinned;
    }

    // A keep-alive that ends at once; GNOME then checks the workspace again.
    _release(workspace) {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            if (manager.get_workspace_by_index(i) === workspace)
                Main.wm.keepWorkspaceAlive(workspace, 0);
        }
    }
}
