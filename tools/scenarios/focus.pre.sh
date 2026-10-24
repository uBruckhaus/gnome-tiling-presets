# Focus follows the mouse (test-only patch): two tiled windows, the pointer moves from
# one to the other without a click; the option off, then the extension disabled, give
# GNOME its own focus mode back.
$S set org.gnome.shell.extensions.tiling-presets default-layout side-by-side
echo "GNOME focus-mode before: $(gsettings get org.gnome.desktop.wm.preferences focus-mode)"
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
    const centre = title => { const f = win(title).get_frame_rect(); return [f.x + f.width / 2, f.y + f.height / 2]; };
    // Moves in small steps and rests, as a hand does (GNOME waits for the pointer to rest).
    const glide = (ms, title) => {
        at(ms, () => { this._from = global.get_pointer().slice(0, 2); this._to = centre(title); });
        for (let i = 1; i <= 8; i++)
            at(ms + i * 40, () => ptr.notify_absolute_motion(now(), ...this._from.map((v, k) => v + (this._to[k] - v) * i / 8)));
    };
    const focus = () => global.display.focus_window?.get_title();
    at(500, () => Main.overview.hide());
    at(9000, () => { win('a').activate(global.get_current_time()); log(`start: focus=${focus()} mode=${this._overrides.current('focus-mode')?.unpack()}`); });
    glide(9500, 'b');
    at(11000, () => log(`pointer over b: focus=${focus()} pointer=${global.get_pointer().slice(0, 2)} b=${centre('b')} a=${centre('a')}`));
    glide(11500, 'a');
    at(13000, () => log(`pointer over a: focus=${focus()} pointer=${global.get_pointer().slice(0, 2)} from=${this._from} to=${this._to}`));
    at(13500, () => this._settings.set_boolean('focus-follows-mouse', false));
    glide(14000, 'b');
    at(15500, () => log(`option off, pointer over b: focus=${focus()} mode=${this._overrides.current('focus-mode')?.unpack()}`));
};
JS
