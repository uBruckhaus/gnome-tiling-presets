# Plain GNOME double-click (option off), on a floating workspace, for comparison.
$S set org.gnome.shell.extensions.tiling-presets header-double-click ${DBL:-false}
cat >> "$EXT/extension.js" <<'JS'
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
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
    const shot = name => {
        const stream = Gio.File.new_for_path(`${GLib.getenv('TP_SHOT_DIR')}/${name}.png`).replace(null, false, 0, null);
        new Shell.Screenshot().screenshot(false, stream, (s, r) => { s.screenshot_finish(r); stream.close(null); });
    };
    const calc = () => global.display.list_all_windows().find(w => w.get_wm_class()?.includes('Calculator'));
    const state = () => { const w = calc(); const f = w?.get_frame_rect(); return `calc above=${w?.is_above()} max=${w?.get_maximize_flags()} frame=${f?.x},${f?.y} ${f?.width}x${f?.height} focus=${global.display.focus_window?.get_title()} border=${this._focusBorder._border.visible} ${this._focusBorder._border.x},${this._focusBorder._border.y} ${this._focusBorder._border.width}x${this._focusBorder._border.height}`; };
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return false; });
    const dbl = (ms, getPoint) => {
        at(ms, () => { const [x, y] = getPoint(); this._pt = [x, y]; ptr.notify_absolute_motion(now(), x, y); });
        at(ms + 100, () => ptr.notify_absolute_motion(now(), ...this._pt));
        for (const [d, down] of [[300, true], [340, false], [420, true], [460, false]])
            at(ms + d, () => ptr.notify_button(now(), 1, down ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED));
    };
    // A point in the calculator's header bar, away from its buttons.
    const header = () => { const f = calc().get_frame_rect(); return [f.x + Math.round(f.width * 0.3), f.y + 20]; };
    // A new virtual pointer starts at 0,0, the hot corner; wake it in the middle first.
    at(8500, () => ptr.notify_absolute_motion(now(), 960, 600));
    at(8600, () => ptr.notify_absolute_motion(now(), 960, 600));
    at(9000, () => Main.overview.hide());
    at(11000, () => { log(`overview before hide: visible=${Main.overview.visible} shown=${Main.overview._shown} visibleTarget=${Main.overview._visibleTarget}`); Main.overview.hide(); });
    at(11800, () => log(`overview after hide: visible=${Main.overview.visible}`));
    at(12000, () => {
        log(`start: ${state()}`);
        const w = calc(); const d = () => { const f = w.get_frame_rect(); return `flags=${w.get_maximize_flags()} ${f.x},${f.y} ${f.width}x${f.height}`; };
        for (const sig of ['notify::maximized-horizontally', 'notify::maximized-vertically', 'size-changed'])
            w.connect(sig, () => log(`  ${sig}: ${d()}`));
    });
    dbl(18000, header);
    at(20000, () => log(`floating ws, after double-click: ${state()}`));
    dbl(20500, () => { const f = calc().get_frame_rect(); return [f.x + Math.round(f.width * 0.3), f.y + 20]; });
    at(22500, () => log(`floating ws, after second double-click: ${state()}`));
    const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    at(23000, () => calc().activate(global.get_current_time()));
    at(23200, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED));
    at(23250, () => kbd.notify_keyval(now(), Clutter.KEY_Left, Clutter.KeyState.PRESSED));
    at(23300, () => kbd.notify_keyval(now(), Clutter.KEY_Left, Clutter.KeyState.RELEASED));
    at(23350, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED));
    at(24500, () => log(`floating ws, after Super+Left: ${state()}`));
};
JS
export TP_SHOT_DIR="${TP_SHOT_DIR:-$ROOT/dist/screenshots}"; mkdir -p "$TP_SHOT_DIR"
