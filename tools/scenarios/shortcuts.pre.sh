# Omarchy shortcuts (test-only patch): all rows on, keys pressed with a virtual keyboard;
# GNOME's own shortcuts checked before, while on and after disabling.
# LAYOUT=de (default), us, fr, … : the keyboard layout; the same physical keys must work.
gsettings set org.gnome.desktop.input-sources sources "[('xkb', '${LAYOUT:-de}')]"
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 5
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"side-by-side","limit":0}}'
printf '%s\n' "import {ROW_IDS} from 'file://$ROOT/tiling-presets@ubruckhaus.github.io/keys.js';" \
    "print(\`[\${ROW_IDS.map(id => \`'\${id}'\`).join(', ')}]\`);" > "$T/ids.js"
ALL=$(gjs -m "$T/ids.js")
$S set org.gnome.shell.extensions.tiling-presets shortcuts "$ALL"
gnome_keys() {
    for k in "org.gnome.desktop.wm.keybindings switch-applications" "org.gnome.desktop.wm.keybindings switch-windows" \
             "org.gnome.desktop.wm.keybindings close" "org.gnome.desktop.wm.keybindings move-to-monitor-left" \
             "org.gnome.mutter.keybindings toggle-tiled-left" "org.gnome.shell.keybindings switch-to-application-1" \
             "org.gnome.shell.keybindings toggle-quick-settings" "org.gnome.desktop.wm.keybindings switch-group" \
             "org.gnome.settings-daemon.plugins.media-keys screensaver" "org.gnome.settings-daemon.plugins.media-keys logout" \
             "org.gnome.settings-daemon.plugins.media-keys magnifier-zoom-out" \
             "org.gnome.desktop.wm.preferences resize-with-right-button"; do
        echo "  $k = $(gsettings get $k)"
    done
}
echo "GNOME before:"; gnome_keys
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
    const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return false; });
    const MODS = {Super: Clutter.KEY_Super_L, Shift: Clutter.KEY_Shift_L, Alt: Clutter.KEY_Alt_L, Ctrl: Clutter.KEY_Control_L};
    // "Super+Shift+Right" at `ms`: modifiers down, key down and up, modifiers up. "#12" is
    // a physical key by its evdev code (#2 … #11 the digit row, #12 and #13 the keys right
    // of 0, #41 the key left of 1), the same in every layout.
    const press = (ms, combo) => {
        const parts = combo.split('+');
        const name = parts.pop();
        const key = (state) => (name.startsWith('#') ? kbd.notify_key(now(), Number(name.slice(1)), state)
            : kbd.notify_keyval(now(), Clutter[`KEY_${name}`], state));
        const mods = parts.map(p => MODS[p]);
        let t = ms;
        for (const m of mods) at(t += 20, () => kbd.notify_keyval(now(), m, Clutter.KeyState.PRESSED));
        at(t += 20, () => key(Clutter.KeyState.PRESSED));
        at(t += 20, () => key(Clutter.KeyState.RELEASED));
        for (const m of mods.reverse()) at(t += 20, () => kbd.notify_keyval(now(), m, Clutter.KeyState.RELEASED));
    };
    const win = name => global.display.list_all_windows().find(w => w.get_wm_class()?.toLowerCase().includes(name));
    const desc = w => { if (!w) return 'none'; const f = w.get_frame_rect(); return `${w.get_wm_class()} ws=${(w.get_workspace()?.index() ?? -2) + 1} ${f.x},${f.y} ${f.width}x${f.height} above=${w.is_above()} sticky=${w.is_on_all_workspaces()} min=${w.minimized}`; };
    const state = label => log(`${label}: active=${global.workspace_manager.get_active_workspace_index() + 1} focus=${global.display.focus_window?.get_wm_class()} layout=${JSON.parse(this._settings.get_string("workspace-presets"))["1"]?.layout} | ${desc(win("alacritty"))} | ${desc(win("calculator"))}`);
    at(8500, () => ptr.notify_absolute_motion(now(), 960, 600));
    at(8600, () => ptr.notify_absolute_motion(now(), 960, 600));
    at(9000, () => Main.overview.hide());
    at(11500, () => { log(`bound: ${[...this._shortcuts._bound].length} keybindings, scroll=${Boolean(this._shortcuts._scroll.id)}`); win('calculator').activate(global.get_current_time()); });
    at(12000, () => state('start (calculator focused)'));
    press(12200, 'Super+Left');
    at(12700, () => state('Super+Left'));
    press(12800, 'Super+Right');
    at(13300, () => state('Super+Right'));
    press(13400, 'Super+Shift+Left');
    at(14000, () => state('Super+Shift+Left (calculator swaps to the left)'));
    press(14100, 'Super+t');
    at(14700, () => state('Super+T (calculator floats)'));
    press(14800, 'Super+#13');
    at(15300, () => state('Super+´ (100 px wider)'));
    press(15400, 'Super+Alt+#12');
    at(15900, () => state('Super+Alt+ß (25 px narrower)'));
    press(16000, 'Super+Shift+#13');
    at(16500, () => state('Super+Shift+´ (100 px taller)'));
    press(16600, 'Super+t');
    at(17200, () => state('Super+T again (tiled)'));
    press(17300, 'Super+l');
    at(17800, () => state('Super+L (next layout)'));
    press(17900, 'Super+Alt+l');
    at(18400, () => state('Super+Alt+L (back)'));
    press(18500, 'Super+j');
    at(19000, () => state('Super+J (split)'));
    press(19100, 'Super+j');
    at(19600, () => state('Super+J again'));
    at(19700, () => this._settings.set_string('workspace-presets', '{"1":{"layout":"master-left","limit":0}}'));
    press(20200, 'Super+Ctrl+#13');
    at(20800, () => state('master-left, Super+Ctrl+´ on the master (300 px wider)'));
    press(20900, 'Super+#3');
    at(21400, () => state('Super+#3'));
    press(21500, 'Super+Ctrl+Tab');
    at(22000, () => state('Super+Ctrl+Tab (former)'));
    press(22100, 'Super+Shift+#4');
    at(22700, () => state('Super+Shift+3 (move and follow)'));
    press(22800, 'Super+Shift+Alt+#2');
    at(23400, () => state('Super+Shift+Alt+1 (silent)'));
    press(23500, 'Super+#2');
    at(24000, () => { win('calculator').activate(global.get_current_time()); });
    press(24300, 'Super+Alt+s');
    at(24900, () => state('Super+Alt+S (calculator to scratchpad)'));
    press(25000, 'Super+s');
    at(25600, () => state('Super+S (scratchpad shown)'));
    press(25700, 'Super+#41');
    at(26300, () => state('Super+^ (scratchpad hidden)'));
    press(26400, 'Super+s');
    press(26700, 'Super+Shift+#41');
    at(27300, () => state('Super+S, Super+Shift+^ (calculator back out)'));
    at(27400, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED));
    at(27500, () => ptr.notify_discrete_scroll(now(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL));
    at(27600, () => kbd.notify_keyval(now(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED));
    at(28000, () => state('Super+wheel down'));
    press(28100, 'Super+Shift+Tab');
    at(28600, () => state('Super+Shift+Tab (GNOME\'s previous workspace)'));
    at(28700, () => win('alacritty').activate(global.get_current_time()));
    press(28900, 'Super+o');
    at(29500, () => state('Super+O (alacritty popped out)'));
    press(29600, 'Super+o');
    at(30200, () => state('Super+O again'));
    press(30300, 'Super+p');
    at(30900, () => state('Super+P (alacritty keeps the size it opened with, centred in its tile)'));
    press(31000, 'Super+p');
    at(31600, () => state('Super+P again'));
    at(31700, () => win('calculator').activate(global.get_current_time()));
    press(31900, 'Super+t');
    press(32300, 'Super+Alt+Home');
    press(32600, 'Super+Ctrl+#13');
    at(33100, () => state('floating, width saved, then 300 px wider'));
    press(33200, 'Super+Home');
    at(33700, () => state('Super+Home (saved width back)'));
    // The scratchpad survives disable/enable, as when the screen is locked and unlocked.
    press(33800, 'Super+Alt+s');
    at(34300, () => { this.disable(); this.enable(); });
    at(35000, () => state('calculator on the scratchpad, extension disabled and enabled'));
    press(35300, 'Super+s');
    at(35900, () => state('Super+S after re-enabling (scratchpad shown)'));
    press(36000, 'Super+Shift+#41');
    press(36400, 'Super+w');
    at(37400, () => state('Super+W (GNOME\'s close)'));
};
JS
