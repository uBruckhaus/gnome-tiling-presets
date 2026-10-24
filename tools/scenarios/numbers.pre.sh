# Workspace numbers: windows on 1 and 2, click "4", screenshot the top bar each time.
$S set org.gnome.shell.extensions.tiling-presets default-layout auto
$S set org.gnome.shell.extensions.tiling-presets default-limit 1
cat >> "$EXT/extension.js" <<'JS'
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    const seat = global.stage.context.get_backend().get_default_seat();
    const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const shot = name => {
        const file = Gio.File.new_for_path(`${GLib.getenv('TP_SHOT_DIR')}/${name}.png`);
        const stream = file.replace(null, false, 0, null);
        new Shell.Screenshot().screenshot_area(0, 0, 700, 40, stream, (s, r) => { s.screenshot_area_finish(r); stream.close(null); });
    };
    const state = () => { const m = global.workspace_manager; return `n=${m.n_workspaces} active=${m.get_active_workspace_index() + 1} buttons=${this._numbers?._box.get_n_children()}`; };
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return GLib.SOURCE_REMOVE; });
    at(9000, () => Main.overview.hide());
    at(12900, () => {
        const orig = this._numbers._activate.bind(this._numbers);
        this._numbers._activate = i => { log(`activate ${i + 1}`); orig(i); };
        const b = this._numbers._box.get_child_at_index(3);
        b.connect('clicked', () => log('clicked signal'));
        log(`button 4 at ${b.get_transformed_position()} size ${b.get_size()} reactive ${b.reactive}`);
    });
    at(13000, () => { log(`before: ${state()}`); shot('numbers-before'); });
    at(13500, () => {
        const b = this._numbers._box.get_child_at_index(3);
        const [x, y] = b.get_transformed_position();
        ptr.notify_absolute_motion(now(), x + 8, y + 8);
        // A new virtual pointer sometimes drops its first motion; move again.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { ptr.notify_absolute_motion(now(), x + 8, y + 8); return false; });
    });
    at(13700, () => { const [px, py] = global.get_pointer(); const a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px, py); log(`pointer ${px},${py} over ${a} ${a?.style_class}`); });
    at(13800, () => ptr.notify_button(now(), 1, Clutter.ButtonState.PRESSED));
    at(13900, () => ptr.notify_button(now(), 1, Clutter.ButtonState.RELEASED));
    at(15500, () => { log(`after click 4: ${state()}`); shot('numbers-after'); });
    at(15800, () => { this._settings.set_boolean('show-workspace-numbers', false); });
    at(16300, () => { log(`hidden: numbers=${this._numbers}`); this._settings.set_boolean('show-workspace-numbers', true); });
    at(16800, () => log(`shown again: ${state()}`));
};
JS
sed -i "s/^import Gio from 'gi:\/\/Gio';$/import Clutter from 'gi:\/\/Clutter';\nimport Gio from 'gi:\/\/Gio';/" "$EXT/extension.js"
export TP_SHOT_DIR="${TP_SHOT_DIR:-$ROOT/dist/screenshots}"; mkdir -p "$TP_SHOT_DIR"
