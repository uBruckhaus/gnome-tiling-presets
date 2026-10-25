# Super+Shift+number (test-only patch): the focused window moves to a new workspace and the
# view follows; the view must stay there, with focus follows the mouse on and off.
$S set org.gnome.shell.extensions.tiling-presets default-layout side-by-side
$S set org.gnome.shell.extensions.tiling-presets focus-follows-mouse ${FFM:-true}
$S set org.gnome.shell.extensions.tiling-presets paused ${PAUSED:-false}
$S set org.gnome.shell.extensions.tiling-presets shortcuts "['workspace-move', 'close', 'workspace-switch', 'workspace-next', 'workspace-former', 'workspace-scroll', 'workspace-move-silent', 'focus', 'swap', 'windows-next', 'resize-drag', 'close-all', 'toggle-floating', 'fullscreen', 'full-width', 'pop-out', 'toggle-split', 'pseudo-tile', 'cycle-layout', 'lock-screen', 'width', 'resize-width', 'resize-height']"
gsettings set org.gnome.desktop.input-sources sources "[('xkb', 'de')]"
cat >> "$EXT/extension.js" <<'JS'
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    if (this._testStarted)
        return;
    this._testStarted = true;
    const seat = global.stage.context.get_backend().get_default_seat();
    const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return false; });
    const win = title => global.display.list_all_windows().find(w => w.get_title() === title);
    const state = () => `active=${global.workspace_manager.get_active_workspace_index() + 1} focus=${global.display.focus_window?.get_title()} b on ${win('b')?.get_workspace()?.index() + 1} of ${global.workspace_manager.n_workspaces}`;
    global.workspace_manager.connect('active-workspace-changed', () => log(`switched: ${state()}`));
    at(8500, () => Main.overview.hide());
    at(9700, () => { log(`overview at 9700: ${Main.overview.visible}`); Main.overview.hide(); });
    // Pointer over the right window, b, which has the focus.
    at(9000, () => { ptr.notify_absolute_motion(now(), 1500, 500); });
    at(9300, () => { ptr.notify_absolute_motion(now(), Number(GLib.getenv("PX") ?? 1440), 540); });
    at(9600, () => win("b").activate(global.get_current_time()));
    const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const key = (code, down) => kbd.notify_key(now(), code, down ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
    if (GLib.getenv('KEYS')) {
        const k = (fn, ms) => at(ms, fn);
        const sym = (v, st) => () => kbd.notify_keyval(now(), v, st);
        const P = Clutter.KeyState.PRESSED, R = Clutter.KeyState.RELEASED;
        at(10000, () => log(`before: ${state()} overview=${Main.overview.visible} bound=${this._shortcuts._bound.size}`));
        // A new virtual keyboard can drop its first keys.
        k(sym(Clutter.KEY_Shift_L, P), 9400); k(sym(Clutter.KEY_Shift_L, R), 9450);
        k(sym(Clutter.KEY_Super_L, P), 10020);
        k(sym(Clutter.KEY_Shift_L, P), 10040);
        k(() => kbd.notify_key(now(), Number(GLib.getenv('KEY') ?? 3), P), 10060);
        k(() => kbd.notify_key(now(), Number(GLib.getenv('KEY') ?? 3), R), 10080);
        k(sym(Clutter.KEY_Shift_L, R), 10100);
        k(sym(Clutter.KEY_Super_L, R), 10120);
    } else {
        at(10000, () => { log(`before: ${state()}`); this._shortcuts._moveTo(win('b'), 1, true); });
    }
    if (GLib.getenv("JIGGLE"))
        for (let i = 0; i < 20; i++)
            at(10070 + i * 25, () => ptr.notify_absolute_motion(now(), Number(GLib.getenv("PX") ?? 1440) + (i % 2) * 3, 540 + i));
    if (GLib.getenv('BACK')) {
        // Then Super+1: workspace 1 again; the moved window keeps its number.
        at(12000, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED));
        at(12020, () => kbd.notify_key(now(), 2, Clutter.KeyState.PRESSED));
        at(12040, () => kbd.notify_key(now(), 2, Clutter.KeyState.RELEASED));
        at(12060, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED));
        at(12800, () => log(`after Super+1: ${state()}`));
    }
    for (const ms of [10100, 10500, 11000, 12000, 13000])
        at(ms, () => log(`+${ms - 10000}ms: ${state()}`));
};
JS
