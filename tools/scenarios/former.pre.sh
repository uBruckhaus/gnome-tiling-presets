# Super+Ctrl+Tab returns to the workspace used last, also after dynamic workspaces renumbered (test-only patch).
$S set org.gnome.shell.extensions.tiling-presets shortcuts "['workspace-former', 'workspace-switch']"
cat >> "$EXT/extension.js" <<'JS'
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    const kbd = global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}`); } return false; });
    const m = global.workspace_manager;
    const win = t => global.display.list_all_windows().find(w => w.get_title() === t);
    const where = () => `active=${m.get_active_workspace_index() + 1} of ${m.n_workspaces}; A=${(win('A')?.get_workspace()?.index() ?? -2) + 1} B=${(win('B')?.get_workspace()?.index() ?? -2) + 1} C=${(win('C')?.get_workspace()?.index() ?? -2) + 1}`;
    at(9000, () => Main.overview.hide());
    // Windows A, B, C on workspaces 1, 2, 3 (dynamic workspaces add a 4th, empty one).
    at(15000, () => { win('B').change_workspace_by_index(1, true); win('C').change_workspace_by_index(2, true); });
    at(16000, () => { m.get_workspace_by_index(1).activate(global.get_current_time()); });
    at(16500, () => { m.get_workspace_by_index(2).activate(global.get_current_time()); });
    at(17000, () => log(`visited B then C: ${where()}`));
    // Closing A removes workspace 1; B and C move down a number.
    at(17200, () => win('A').delete(global.get_current_time()));
    at(18500, () => log(`A closed: ${where()}`));
    at(18700, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED));
    at(18720, () => kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED));
    at(18740, () => kbd.notify_keyval(now(), Clutter.KEY_Tab, Clutter.KeyState.PRESSED));
    at(18760, () => kbd.notify_keyval(now(), Clutter.KEY_Tab, Clutter.KeyState.RELEASED));
    at(18780, () => kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED));
    at(18800, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED));
    at(19500, () => log(`Super+Ctrl+Tab (should be B's workspace): ${where()}`));
};
JS
