# Test-only patch: the settings window opens on the About page and the screen is saved.
sed -i 's/^        window.add(this._aboutPage());$/        const about = this._aboutPage(); window.add(about); window.set_visible_page(about); window.set_default_size(720, 1040);/' "$EXT/prefs.js"
cat >> "$EXT/extension.js" <<'JS'
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 9000, () => {
        Main.overview.hide();
        this.openPreferences();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            const stream = Gio.File.new_for_path(GLib.getenv('TP_SHOT')).replace(null, false, 0, null);
            new Shell.Screenshot().screenshot(false, stream, (s, r) => { s.screenshot_finish(r); stream.close(null); console.log('[Tiling Presets] about screenshot written'); });
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
};
JS
export TP_SHOT="${TP_SHOT_DIR:-$ROOT/dist/screenshots}/about.png"; mkdir -p "$(dirname "$TP_SHOT")"
