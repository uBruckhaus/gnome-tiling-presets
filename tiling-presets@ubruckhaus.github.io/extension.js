import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AppPresets} from './appPresets.js';
import {HeaderDoubleClick} from './doubleClick.js';
import {FocusBorder} from './focusBorder.js';
import {GnomeOverrides} from './gnomeOverrides.js';
import {Indicator} from './indicator.js';
import {Shortcuts} from './shortcuts.js';
import {Tiler} from './tiler.js';
import {WorkspaceNumbers} from './workspaceNumbers.js';
import {WorkspacePins} from './workspacePins.js';

export default class TilingPresetsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const log = message => {
            if (this._settings.get_boolean('debug'))
                console.log(`[Tiling Presets] ${message}`);
        };
        this._tiler = new Tiler(this._settings, log, this.metadata.name);
        this._appPresets = new AppPresets(this._settings, this._tiler, log);
        this._indicator = new Indicator(this, this._tiler, this._appPresets);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._numbersId = this._settings.connect('changed::show-workspace-numbers',
            () => this._syncNumbers());
        this._syncNumbers();
        this._pins = new WorkspacePins(this._settings);
        this._pins.enable();

        this._focusBorder = new FocusBorder(this._settings);
        this._focusBorder.enable();
        this._doubleClick = new HeaderDoubleClick(this._settings, this._tiler);
        this._doubleClick.enable();
        this._overrides = new GnomeOverrides(this._settings);
        this._overrides.syncButtons();
        this._overrides.syncDoubleClick();
        this._overrides.syncFocus();
        this._overrideIds = [
            ...['minimize', 'maximize', 'close'].map(button => this._settings.connect(
                `changed::show-${button}-button`, () => this._overrides.syncButtons())),
            this._settings.connect('changed::header-double-click', () => this._overrides.syncDoubleClick()),
            this._settings.connect('changed::focus-follows-mouse', () => this._overrides.syncFocus()),
        ];
        this._shortcuts = new Shortcuts(this, this._settings, this._tiler, this._overrides, log);
        this._shortcuts.enable();

        const start = () => {
            this._tiler.enable();
            this._appPresets.restoreAtLogin();
        };
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                start();
            });
        } else {
            start();
        }
    }

    // The numbers sit on the left, right after GNOME's Activities button.
    _syncNumbers() {
        const show = this._settings.get_boolean('show-workspace-numbers');
        if (show && !this._numbers) {
            this._numbers = new WorkspaceNumbers(this._settings);
            Main.panel.addToStatusArea(`${this.uuid}-workspaces`, this._numbers, 1, 'left');
        } else if (!show && this._numbers) {
            this._numbers.destroy();
            this._numbers = null;
        }
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        } else {
            this._tiler.disable();
        }
        this._settings.disconnect(this._numbersId);
        this._overrideIds.forEach(id => this._settings.disconnect(id));
        this._shortcuts.disable();
        this._shortcuts = null;
        this._overrides.releaseAll();
        this._overrides.destroy();
        this._overrides = null;
        this._doubleClick.disable();
        this._doubleClick = null;
        this._focusBorder.disable();
        this._focusBorder = null;
        this._numbers?.destroy();
        this._numbers = null;
        this._pins.disable();
        this._pins = null;
        this._appPresets.destroy();
        this._indicator.destroy();
        this._indicator = null;
        this._appPresets = null;
        this._tiler = null;
        this._settings = null;
    }
}
