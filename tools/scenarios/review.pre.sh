# The review fixes (test-only patch): window choices (scratchpad, pseudo-tiling, opening
# size) survive disable/enable through the window-state setting; GNOME settings that had
# no value of the user's own are reset, not written back; a restore on a fixed number of
# workspaces adds none; restore holds go through WorkspacePins and end on disable.
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 2
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"side-by-side","limit":3}}'
$S set org.gnome.shell.extensions.tiling-presets app-presets '{"4":{"apps":[{"id":"org.gnome.Calculator.desktop","name":"Calculator","icon":"org.gnome.Calculator"}],"windows":[{"app":"org.gnome.Calculator.desktop"}],"layout":"side-by-side","limit":2,"ownPreset":true,"autostart":false}}'
cat >> "$EXT/extension.js" <<'JS'
import GLib from 'gi://GLib';
const _origEnable = TilingPresetsExtension.prototype.enable;
TilingPresetsExtension.prototype.enable = function () {
    _origEnable.call(this);
    const log = m => console.log(`[Tiling Presets] TEST ${m}`);
    const at = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { try { fn(); } catch (e) { log(`error ${e}\n${e.stack}`); } return false; });
    const win = cls => global.display.list_all_windows().find(w => w.get_wm_class() === cls);
    const state = () => {
        const a = win('Alacritty'), c = win('org.gnome.Calculator');
        return `alacritty scratch=${this._tiler._scratch.has(a)} calculator pseudo=${this._tiler._pseudo.has(c)} natural=${JSON.stringify(this._tiler._natural.get(c))}`;
    };
    if (this._testRuns === undefined) {
        this._testRuns = 1;
        at(11000, () => {
            this._tiler.setScratch(win('Alacritty'), true);
            this._tiler.togglePseudo?.(win('org.gnome.Calculator')) ?? this._tiler._pseudo.add(win('org.gnome.Calculator'));
            log(`before disable: ${state()}`);
        });
        at(12000, () => {
            const n = global.workspace_manager.n_workspaces;
            this._appPresets.restore(3);
            log(`fixed workspaces: ${n} before restore of 4, ${global.workspace_manager.n_workspaces} after`);
            this._pins.hold([global.workspace_manager.get_workspace_by_index(1)], 60000);
            log(`holds while enabled: ${this._pins._holds.size}, timer=${Boolean(this._pins._holdId)}`);
            this._testPins = this._pins;
        });
    } else {
        at(1500, () => log(`after disable/enable: ${state()}`));
    }
};
const _origDisable = TilingPresetsExtension.prototype.disable;
TilingPresetsExtension.prototype.disable = function () {
    const pins = this._pins;
    _origDisable.call(this);
    console.log(`[Tiling Presets] TEST after disable: holds ${pins._holds.size}, timer=${Boolean(pins._holdId)}`);
};
JS
