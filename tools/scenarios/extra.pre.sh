# Master proportion across disable/enable, and App Preset restore un-minimizing (test-only patch).
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"master-left","limit":3}}'
$S set org.gnome.shell.extensions.tiling-presets app-presets '{"1":{"apps":[{"id":"Alacritty.desktop","name":"Alacritty","icon":"Alacritty"}],"windows":[{"app":"Alacritty.desktop","wmClass":"Alacritty","title":"x","monitor":0,"floating":false,"maximized":false,"above":false,"minimized":false,"fullscreen":false,"rect":{"x":0,"y":0,"width":0.5,"height":1}}],"layout":"master-left","limit":3,"ownPreset":true,"autostart":false}}'
cat >> "$EXT/extension.js" <<'JS'
import GLib from 'gi://GLib';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return false; });
    const widths = () => global.workspace_manager.get_workspace_by_index(0).list_windows().map(w => `${w.get_wm_class()}:${w.get_frame_rect().width}${w.minimized ? '(min)' : ''}`).join(' ');
    if (this._testRuns === undefined) {
        this._testRuns = 1;
        at(12000, () => {
            const ws = global.workspace_manager.get_workspace_by_index(0);
            this._tiler._ratios.set(ws, 0.7);
            this._tiler.retileAll();
        });
        at(13000, () => log(`with 70%: ${widths()}`));
    } else {
        at(1500, () => log(`after disable/enable: ${widths()}`));
        at(2000, () => global.display.list_all_windows().find(w => w.get_wm_class() === 'Alacritty').minimize());
        at(2500, () => { log(`minimized: ${widths()}`); this._appPresets.restore(0); });
        at(4000, () => log(`after restore: ${widths()}`));
    }
};
JS
