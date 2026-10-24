# Test-only patch of the copied extension: open the menu and screenshot the stage.
[ -n "${LAYOUT:-}" ] && gsettings set org.gnome.desktop.input-sources sources "[('xkb', '$LAYOUT')]"
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"master-left","limit":3}}'
$S set org.gnome.shell.extensions.tiling-presets app-presets '{"1":{"apps":[{"id":"Alacritty.desktop","name":"Alacritty","icon":"Alacritty"},{"id":"org.gnome.Calculator.desktop","name":"Calculator","icon":"org.gnome.Calculator"}],"windows":[{"app":"Alacritty.desktop"},{"app":"org.gnome.Calculator.desktop"}],"layout":"master-left","limit":3,"ownPreset":true,"autostart":false,"saved":"2026-10-24 13:00"}}'
$S set org.gnome.shell.extensions.tiling-presets shortcuts "['focus', 'swap', 'scratchpad', 'resize-width']"
cat >> "$EXT/extension.js" <<'JS'
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    // A keyboard, so apps (the settings window) get the keyboard layout.
    this._testKeyboard ??= global.stage.context.get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 9000, () => {
        Main.overview.hide();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._indicator.menu.open(false);
            console.log(`[Tiling Presets] menu open: ${this._indicator.menu.isOpen}, items ${this._indicator.menu.numMenuItems}`);
            return GLib.SOURCE_REMOVE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            const file = Gio.File.new_for_path(GLib.getenv('TP_SHOT'));
            const stream = file.replace(null, false, 0, null);
            new Shell.Screenshot().screenshot(false, stream, (s, res) => {
                s.screenshot_finish(res); stream.close(null); console.log('[Tiling Presets] screenshot written');
                this._indicator.menu.close(false);
                this.openPreferences();
                [1, 2, 3, 4, 5, 6].forEach(page => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500 + 2000 * page, () => {
                    const f2 = Gio.File.new_for_path(GLib.getenv('TP_SHOT').replace('.png', `-prefs${page}.png`));
                    const s2 = f2.replace(null, false, 0, null);
                    new Shell.Screenshot().screenshot(false, s2, (sc, r) => {
                        sc.screenshot_finish(r); s2.close(null); console.log(`[Tiling Presets] prefs screenshot ${page} written`);
                    });
                    return GLib.SOURCE_REMOVE;
                }));
            });
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
};
JS
export TP_SHOT="${TP_SHOT_DIR:-$ROOT/dist/screenshots}/menu.png"; mkdir -p "$(dirname "$TP_SHOT")"
# Show each settings page in turn for the screenshots (test-only).
sed -i 's/^        rebuild();$/        rebuild();\n        [tilingPage, windowsPage, workspacesPage, shortcutsPage, presetsPage].forEach((p, i) => GLib.timeout_add(0, 1500 + 2000 * i, () => { window.set_visible_page(p); return false; })); GLib.timeout_add(0, 1500 + 2000 * 5, () => { window.set_visible_page(shortcutsPage); const sw = shortcutsPage.get_first_child(); GLib.timeout_add(0, 300, () => { sw.vadjustment.value = sw.vadjustment.upper; return false; }); return false; });/' "$EXT/prefs.js"
sed -i "s/^import Adw from 'gi:\/\/Adw';/import Adw from 'gi:\/\/Adw';\nimport GLib from 'gi:\/\/GLib';/" "$EXT/prefs.js"
