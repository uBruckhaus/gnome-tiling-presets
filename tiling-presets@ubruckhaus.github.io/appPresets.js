// App Presets: save the apps on a workspace and how they are arranged, and
// restore them (launch what is missing, move windows in, rebuild the layout).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {appPresets, presetFor, setAppPreset, setWorkspacePreset} from './config.js';
import {isTilingLayout} from './layouts.js';

const LAUNCH_SPACING = 400;    // ms between launches, so single-instance apps settle
const RESTORE_TIMEOUT = 30;    // s to wait for launched apps to show a window
const LOGIN_DELAY = 3;         // s after the shell has started

function isAppWindow(window) {
    return window.get_window_type() === Meta.WindowType.NORMAL &&
        !window.is_skip_taskbar() && !window.get_transient_for() && !window.is_on_all_workspaces();
}

// Shell gives windows without a desktop file an app id like "window:12".
function restorableApp(app) {
    const id = app?.get_id();
    return id && !id.startsWith('window:') ? id : '';
}

export class AppPresets {
    constructor(settings, tiler, log) {
        this._settings = settings;
        this._tiler = tiler;
        this._log = log;
        this._tracker = Shell.WindowTracker.get_default();
        this._appSystem = Shell.AppSystem.get_default();
        this._timeouts = new Set();
        this._restore = null;
        this._queue = [];
        tiler.claimWindow = window => this._claimNew(window);
    }

    destroy() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._restore = null;
        this._queue = [];
        this._tiler.claimWindow = null;
    }

    all() {
        return appPresets(this._settings);
    }

    get(number) {
        return appPresets(this._settings)[number] ?? null;
    }

    get busy() {
        return this._restore !== null;
    }

    // --- Saving -------------------------------------------------------------------

    save(index) {
        const workspace = global.workspace_manager.get_workspace_by_index(index);
        if (!workspace)
            return 0;
        const number = index + 1;
        const preset = presetFor(this._settings, number);
        const tiling = isTilingLayout(preset.layout);
        const windows = workspace.list_windows()
            .filter(isAppWindow)
            .sort((a, b) => this._tiler.orderOf(a) - this._tiler.orderOf(b));

        const apps = [];
        const saved = [];
        let skipped = 0;
        for (const window of windows) {
            const app = this._tracker.get_window_app(window);
            const id = restorableApp(app);
            if (!id) {
                skipped++;
                continue;
            }
            if (!apps.some(entry => entry.id === id))
                apps.push({id, name: app.get_name() ?? id, icon: app.get_icon()?.to_string() ?? ''});
            const monitor = window.get_monitor();
            const area = workspace.get_work_area_for_monitor(monitor);
            const frame = window.get_frame_rect();
            saved.push({
                app: id,
                wmClass: window.get_wm_class() ?? '',
                title: window.get_title() ?? '',
                monitor,
                floating: !tiling || !this._tiler.isTileable(window),
                maximized: window.get_maximize_flags() === Meta.MaximizeFlags.BOTH,
                above: window.is_above(),
                minimized: window.minimized,
                fullscreen: window.is_fullscreen(),
                rect: {
                    x: (frame.x - area.x) / area.width,
                    y: (frame.y - area.y) / area.height,
                    width: frame.width / area.width,
                    height: frame.height / area.height,
                },
            });
        }
        if (!saved.length)
            return 0;

        setAppPreset(this._settings, number, {
            apps,
            windows: saved,
            layout: preset.layout,
            limit: preset.limit,
            ownPreset: preset.own,
            autostart: this.get(number)?.autostart ?? false,
            saved: GLib.DateTime.new_now_local().format('%F %R'),
        });
        if (skipped) {
            Main.notify(_('Tiling Presets'), ngettext(
                '%d window has no app that can be started again and was not saved.',
                '%d windows have no app that can be started again and were not saved.',
                skipped).format(skipped));
        }
        return saved.length;
    }

    remove(number) {
        setAppPreset(this._settings, number, null);
    }

    setAutostart(number, autostart) {
        const data = this.get(number);
        if (data)
            setAppPreset(this._settings, number, {...data, autostart});
    }

    // --- Restoring ----------------------------------------------------------------

    restore(index) {
        if (this._restore) {
            if (!this._queue.includes(index) && this._restore.index !== index)
                this._queue.push(index);
            return;
        }
        const number = index + 1;
        const data = this.get(number);
        if (!data?.windows?.length)
            return this._next();

        const manager = global.workspace_manager;
        while (manager.n_workspaces <= index)
            manager.append_new_workspace(false, global.get_current_time());
        const workspace = manager.get_workspace_by_index(index);
        // Dynamic workspaces would remove the empty ones (and renumber) while apps start.
        const duration = data.windows.length * LAUNCH_SPACING + (RESTORE_TIMEOUT + 2) * 1000;
        for (let i = 0; i <= index; i++)
            Main.wm.keepWorkspaceAlive(manager.get_workspace_by_index(i), duration);
        // The layout saved with the App Preset is part of it, even if it came from the default.
        const current = presetFor(this._settings, number);
        if (data.ownPreset || current.layout !== data.layout || current.limit !== data.limit)
            setWorkspacePreset(this._settings, number, {layout: data.layout, limit: data.limit});

        const base = this._tiler.reserveOrder(data.windows.length);
        const slots = data.windows.map((saved, rank) => ({saved, seq: base + rank}));
        const claimed = new Set();
        const here = workspace.list_windows().filter(isAppWindow);
        const idOf = window => restorableApp(this._tracker.get_window_app(window));

        // 1. Windows already on the workspace, best match first.
        const match = (slot, candidates) =>
            candidates.find(w => !claimed.has(w) && idOf(w) === slot.saved.app && w.get_title() === slot.saved.title) ??
            candidates.find(w => !claimed.has(w) && idOf(w) === slot.saved.app);
        for (const slot of slots) {
            slot.window = match(slot, here);
            if (slot.window)
                claimed.add(slot.window);
        }

        // 2. Single-window apps open elsewhere are moved here; everything else is launched.
        const launches = [];
        const missing = [];
        for (const slot of slots.filter(s => !s.window)) {
            const app = this._appSystem.lookup_app(slot.saved.app);
            if (!app) {
                missing.push(slot.saved.app.replace(/\.desktop$/, ''));
                continue;
            }
            if (!app.can_open_new_window()) {
                slot.window = match(slot, app.get_windows().filter(isAppWindow));
                if (slot.window) {
                    claimed.add(slot.window);
                    continue;
                }
            }
            launches.push({slot, app});
        }

        // 3. Windows on the workspace that are not part of the preset.
        const conflicts = here.filter(w => !claimed.has(w));
        const action = this._settings.get_string('restore-conflicts');
        for (const window of conflicts) {
            if (action === 'close') {
                window.delete(global.get_current_time());
            } else if (action === 'move') {
                const target = this._tiler.findRoom(index);
                if (target >= 0)
                    window.change_workspace_by_index(target, true);
                else
                    this._tiler.moveToEnd(window);
            } else {
                this._tiler.moveToEnd(window);
            }
        }

        const restore = {index, workspace, pending: launches.map(l => l.slot), missing};
        this._restore = restore;
        this._log(`restore workspace ${number}: ${slots.length - launches.length - missing.length} present, ` +
            `${launches.length} to launch, ${conflicts.length} conflicting (${action})`);
        for (const slot of slots.filter(s => s.window))
            this._adopt(slot, slot.window);

        launches.forEach(({app}, i) => this._later(i * LAUNCH_SPACING, () => {
            if (this._restore !== restore)
                return;
            try {
                app.open_new_window(this._targetIndex(restore));
            } catch (e) {
                this._log(`launching ${app.get_id()} failed: ${e.message}`);
            }
        }));
        this._later(launches.length * LAUNCH_SPACING + RESTORE_TIMEOUT * 1000, () => {
            if (this._restore === restore)
                this._finish();
        });
        if (!launches.length)
            this._finish();
    }

    restoreAll(onlyAutostart = false) {
        const numbers = Object.entries(appPresets(this._settings))
            .filter(([, data]) => !onlyAutostart || data.autostart)
            .map(([number]) => Number(number))
            .filter(number => Number.isInteger(number) && number > 0)
            .sort((a, b) => a - b);
        for (const number of numbers)
            this.restore(number - 1);
    }

    // Restores the App Presets marked for login once per shell session (not after unlocking).
    restoreAtLogin() {
        const marker = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'tiling-presets-login']));
        const stamp = String(new Gio.Credentials().get_unix_pid());
        try {
            const [, contents] = marker.load_contents(null);
            if (new TextDecoder().decode(contents) === stamp)
                return;
        } catch {}
        // The marker is written when the restore starts, so a disable before then does not skip it.
        this._later(LOGIN_DELAY * 1000, () => {
            try {
                marker.replace_contents(new TextEncoder().encode(stamp), null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (e) {
                this._log(`cannot write ${marker.get_path()}: ${e.message}`);
            }
            this.restoreAll(true);
        });
    }

    _claimNew(window) {
        const restore = this._restore;
        if (!restore?.pending.length || !isAppWindow(window))
            return false;
        const id = restorableApp(this._tracker.get_window_app(window));
        const wmClass = window.get_wm_class();
        const slot = restore.pending.find(s => id && s.saved.app === id) ??
            restore.pending.find(s => wmClass && s.saved.wmClass === wmClass);
        if (!slot)
            return false;
        restore.pending.splice(restore.pending.indexOf(slot), 1);
        this._adopt(slot, window);
        if (!restore.pending.length)
            this._finish();
        return true;
    }

    // The workspace's current index; dynamic workspaces may have renumbered it.
    _targetIndex(restore) {
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            if (manager.get_workspace_by_index(i) === restore.workspace)
                return i;
        }
        return restore.index;
    }

    _adopt(slot, window) {
        const restore = this._restore;
        const index = this._targetIndex(restore);
        const workspace = global.workspace_manager.get_workspace_by_index(index) ?? restore.workspace;
        const {saved} = slot;
        const monitor = saved.monitor < global.display.get_n_monitors() ? saved.monitor
            : global.display.get_primary_monitor();
        if (window.get_monitor() !== monitor)
            window.move_to_monitor(monitor);
        if (window.get_workspace() !== workspace)
            window.change_workspace_by_index(index, true);
        this._tiler.setOrder(window, slot.seq);
        // A window restored to its place is no longer on the scratchpad.
        if (this._tiler.isScratch(window))
            this._tiler.setScratch(window, false);
        // Floating (Always on Top) is part of the saved state, both ways.
        if (saved.above && !window.is_above())
            window.make_above();
        else if (saved.above === false && window.is_above())
            window.unmake_above();
        // Minimized and fullscreen are part of the saved state, both ways; windows in
        // either state stay outside the layout, as they were when saved.
        if (saved.fullscreen && !window.is_fullscreen())
            window.make_fullscreen();
        else if (!saved.fullscreen && window.is_fullscreen())
            window.unmake_fullscreen();
        if (saved.minimized)
            window.minimize();
        else if (window.minimized)
            window.unminimize();
        if (saved.fullscreen || saved.minimized)
            return;
        if (saved.maximized) {
            // Marked as arranged, so the tiler leaves the maximized window alone.
            this._tiler.markPlaced(window);
            window.set_maximize_flags(Meta.MaximizeFlags.BOTH);
            return;
        }
        if (!saved.floating && this._tiler.isTileable(window))
            return;
        if (window.get_maximize_flags())
            window.unmaximize();
        const area = workspace.get_work_area_for_monitor(monitor);
        window.move_resize_frame(false,
            Math.round(area.x + saved.rect.x * area.width),
            Math.round(area.y + saved.rect.y * area.height),
            Math.round(saved.rect.width * area.width),
            Math.round(saved.rect.height * area.height));
    }

    _finish() {
        const restore = this._restore;
        if (!restore)
            return;
        this._restore = null;
        const missing = [...restore.missing, ...restore.pending.map(s => s.saved.app.replace(/\.desktop$/, ''))];
        if (missing.length) {
            Main.notify(_('Tiling Presets'),
                _('Workspace %d: these apps did not open: %s').format(restore.index + 1, missing.join(', ')));
        }
        this._tiler.retileAll();
        this._next();
    }

    _next() {
        const index = this._queue.shift();
        if (index !== undefined)
            this.restore(index);
    }

    _later(delay, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }
}
