# Test-only patch: logs every window a while after the settings opened.
cat >> "$EXT/extension.js" <<'JS'
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    if (this._testStarted)
        return;
    this._testStarted = true;
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const describe = w => { const f = w.get_frame_rect(); return `${w.get_wm_class()} "${w.get_title()}" type=${w.get_window_type()} transient=${Boolean(w.get_transient_for())} ws${(w.get_workspace()?.index() ?? -2) + 1} above=${w.is_above()} ${f.x},${f.y} ${f.width}x${f.height}`; };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20000, () => {
        for (const w of global.display.list_all_windows())
            log(describe(w));
        const prefs = global.display.list_all_windows().find(w => w.get_title() === 'Tiling Presets');
        log(`stacking top: ${global.display.sort_windows_by_stacking(global.display.list_all_windows()).map(w => w.get_title()).join(' < ')}`);
        if (prefs) {
            global.display.list_all_windows().find(w => w.get_title() === 'term1').activate(global.get_current_time());
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                log(`after focusing term1: ${global.display.sort_windows_by_stacking(global.display.list_all_windows()).map(w => w.get_title()).join(' < ')}`);
                return false;
            });
        }
        return false;
    });
};
JS
