# Test-only patch: drive a virtual pointer. Right-click the top-bar button (pause), left-click
# (menu opens), then drag the calculator's header bar onto the left window (swap).
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"side-by-side","limit":2}}'
cat >> "$EXT/extension.js" <<'JS'
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    const seat = global.stage.context.get_backend().get_default_seat();
    const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const steps = [];
    const at = (ms, fn) => steps.push([ms, fn]);
    const move = (x, y) => ptr.notify_absolute_motion(now(), x, y);
    const button = (b, down) => ptr.notify_button(now(), b, down ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED);
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    at(9000, () => Main.overview.hide());
    at(10500, () => { const [x, y] = this._indicator.get_transformed_position(); this._bx = x + 10; this._by = y + 10; move(this._bx, this._by); });
    // A new virtual pointer sometimes drops its first motion; move again.
    at(10600, () => move(this._bx, this._by));
    at(10700, () => { const [px, py] = global.get_pointer(); const a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px, py); log(`indicator at ${this._indicator.get_transformed_position()} pointer ${px},${py} over ${a?.constructor?.name} ${a?.style_class}`); });
    at(10800, () => button(3, true));
    at(10900, () => button(3, false));
    at(11300, () => log(`after right-click: paused=${this._settings.get_boolean('paused')} menuOpen=${this._indicator.menu.isOpen}`));
    at(11400, () => button(1, true));
    at(11500, () => button(1, false));
    at(11900, () => log(`after left-click: menuOpen=${this._indicator.menu.isOpen}`));
    at(12000, () => { this._indicator.menu.close(false); this._settings.set_boolean('paused', false); });
    // Drag the calculator (right half) by its header bar to the left half.
    at(13000, () => move(1250, 62));
    at(13200, () => button(1, true));
    for (let i = 1; i <= 20; i++)
        at(13300 + i * 30, () => move(1250 - i * 40, 62 + i * 10));
    at(14200, () => button(1, false));
    at(15000, () => log('drag done'));
    for (const [ms, fn] of steps)
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}`); } return GLib.SOURCE_REMOVE; });
};
JS
