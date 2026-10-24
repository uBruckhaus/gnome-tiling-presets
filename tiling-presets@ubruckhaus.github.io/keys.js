// The Omarchy shortcuts on the Shortcuts page, and how they fit around GNOME's own.
// Shared by the extension and the preferences; the planning is pure, so the tests run
// in plain gjs.
//
// Each row lists keys of the keybindings schema. A row with `gnome` hands its keys to
// GNOME's own shortcut instead of the extension's (close, full screen, …). Any GNOME
// shortcut on the same keys is taken off them while the row is on, and gets them back
// when it is off.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const WM_KEYS = 'org.gnome.desktop.wm.keybindings';
export const WM_PREFS = 'org.gnome.desktop.wm.preferences';
const MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';

// GNOME's shortcut lists that may hold the same keys.
export const GNOME_SCHEMAS = [
    WM_KEYS,
    'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    MEDIA_KEYS,
];
// Lists of paths, not keys.
const NOT_KEYS = new Set([`${MEDIA_KEYS} custom-keybindings`]);

const numbered = prefix => Array.from({length: 10}, (_, i) => `${prefix}-${i + 1}`);
const directions = prefix => ['left', 'right', 'up', 'down'].map(d => `${prefix}-${d}`);

// Shown in the order of the Omarchy list. `keys` replaces the key list for rows without
// bindings; `variants` rows show only the first key of each binding (the others add Alt
// or Ctrl, as the subtitle says).
export const GROUPS = [
    {
        title: 'Workspaces',
        rows: [
            {id: 'workspace-switch', title: 'Switch to workspace 1 … 10', bindings: numbered('workspace')},
            {
                id: 'workspace-move', title: 'Move window to workspace 1 … 10',
                subtitle: 'And follow it', bindings: numbered('window-to-workspace'),
            },
            {
                id: 'workspace-move-silent', title: 'Move window to workspace 1 … 10 silently',
                subtitle: 'Stay on this workspace', bindings: numbered('window-to-workspace-silent'),
            },
            {
                id: 'workspace-next', title: 'Next / previous workspace',
                bindings: ['workspace-next', 'workspace-previous'],
                gnome: {
                    'workspace-next': [WM_KEYS, 'switch-to-workspace-right'],
                    'workspace-previous': [WM_KEYS, 'switch-to-workspace-left'],
                },
            },
            {
                id: 'workspace-former', title: 'Former workspace',
                subtitle: 'The one used last', bindings: ['workspace-former'],
            },
            {id: 'workspace-scroll', title: 'Next / previous workspace', keys: 'Super + mouse wheel'},
        ],
    },
    {
        title: 'Focus and move windows',
        rows: [
            {id: 'focus', title: 'Focus window left / right / above / below', bindings: directions('focus')},
            {
                id: 'swap', title: 'Swap window left / right / up / down',
                subtitle: 'Tiled windows trade places; at the edge the window moves to the next monitor',
                bindings: directions('swap'),
            },
            {
                id: 'windows-next', title: 'Focus next / previous window',
                bindings: ['windows-next', 'windows-previous'],
                gnome: {
                    'windows-next': [WM_KEYS, 'switch-windows'],
                    'windows-previous': [WM_KEYS, 'switch-windows-backward'],
                },
            },
            {
                id: 'resize-drag', title: 'Resize window', keys: 'Super + right mouse drag',
                subtitle: 'The window menu then opens with Super + middle click',
                setting: [WM_PREFS, 'resize-with-right-button', true],
            },
        ],
    },
    {
        title: 'Window state and layout',
        rows: [
            {
                id: 'close', title: 'Close window', bindings: ['close-window'],
                gnome: {'close-window': [WM_KEYS, 'close']},
            },
            {id: 'close-all', title: 'Close all windows', bindings: ['close-all']},
            {
                id: 'toggle-floating', title: 'Toggle floating / tiling',
                subtitle: 'Like a double-click on the title bar', bindings: ['toggle-floating'],
            },
            {
                id: 'fullscreen', title: 'Full screen', bindings: ['fullscreen'],
                gnome: {fullscreen: [WM_KEYS, 'toggle-fullscreen']},
            },
            {
                id: 'full-width', title: 'Full width',
                subtitle: 'Maximized, the top bar stays', bindings: ['full-width'],
                gnome: {'full-width': [WM_KEYS, 'toggle-maximized']},
            },
            {
                id: 'pop-out', title: 'Pop window out',
                subtitle: 'Float it and show it on all workspaces; again to put it back',
                bindings: ['pop-out'],
            },
            {
                id: 'toggle-split', title: 'Toggle split direction',
                subtitle: 'Switches the workspace between Side by side and Stacked',
                bindings: ['toggle-split'],
            },
            {
                id: 'pseudo-tile', title: 'Pseudo-tile window',
                subtitle: 'The window keeps the size it opened with, centred in its tile',
                bindings: ['pseudo-tile'],
            },
            {
                id: 'cycle-layout', title: 'Cycle workspace layout / back',
                bindings: ['cycle-layout', 'cycle-layout-backward'],
            },
            {
                id: 'lock-screen', title: 'Lock screen',
                subtitle: 'Omarchy\'s lock key, so Super + L is free for cycling layouts',
                bindings: ['lock-screen'],
                gnome: {'lock-screen': [MEDIA_KEYS, 'screensaver']},
            },
            {
                id: 'width', title: 'Save / restore window width',
                bindings: ['save-width', 'restore-width'],
            },
        ],
    },
    {
        title: 'Resize with the keyboard',
        rows: [
            {
                id: 'resize-width', title: 'Narrower / wider', variants: true,
                subtitle: '100 px; with Alt 25 px, with Ctrl 300 px. Tiled windows change the master\'s share.',
                bindings: ['resize-narrower', 'resize-wider'],
            },
            {
                id: 'resize-height', title: 'Shorter / taller', variants: true,
                subtitle: '100 px; with Alt 25 px, with Ctrl 300 px. Floating windows only.',
                bindings: ['resize-shorter', 'resize-taller'],
            },
        ],
    },
    {
        title: 'Monitors',
        rows: [
            {
                id: 'monitor-focus', title: 'Focus next / previous monitor',
                bindings: ['monitor-next', 'monitor-previous'],
            },
            {
                id: 'monitor-move', title: 'Move window to monitor left / right / up / down',
                bindings: directions('window-to-monitor'),
                gnome: Object.fromEntries(['left', 'right', 'up', 'down'].map(d =>
                    [`window-to-monitor-${d}`, [WM_KEYS, `move-to-monitor-${d}`]])),
            },
        ],
    },
    {
        title: 'Scratchpad',
        description: 'A hidden place for windows you call up when needed, like Omarchy\'s.',
        rows: [
            {id: 'scratchpad', title: 'Show / hide scratchpad', bindings: ['scratchpad']},
            {
                id: 'to-scratchpad', title: 'Move window to scratchpad',
                subtitle: 'Again to take it back out', bindings: ['to-scratchpad'],
            },
        ],
    },
];

export const ROWS = GROUPS.flatMap(group => group.rows);
export const ROW_IDS = ROWS.map(row => row.id);

// Omarchy shortcuts that need nothing, and those GNOME cannot do.
export const ALREADY_IN_GNOME = [
    {title: 'Move window', keys: 'Super + left mouse drag'},
];
export const NOT_IN_GNOME = [
    {title: 'Tiled full screen', keys: 'Super + Ctrl + F', reason: 'GNOME has no full screen inside a tile'},
    {title: 'Move whole workspace to another monitor', keys: 'Super + Shift + Alt + arrows',
        reason: 'GNOME\'s workspaces span all monitors'},
    {title: 'Window groups (tabs)', keys: 'Super + G, Super + Alt + …',
        reason: 'GNOME has no tabbed windows'},
];

// --- Keys ---------------------------------------------------------------------------
//
// Like Omarchy (Hyprland's code:10 …), keys that differ between keyboard layouts are
// bound by their place on the keyboard: "0x0a" … "0x13" is the digit row, "0x14" and
// "0x15" the two keys right of 0, "Above_Tab" the key left of 1. Mutter reads such
// key codes in any layout. Letters, arrows, Tab, Home and Delete keep their names.

const MODIFIERS = {
    primary: 'control', control: 'control', ctrl: 'control',
    alt: 'alt', mod1: 'alt', super: 'super', mod4: 'super',
    shift: 'shift', meta: 'meta', hyper: 'hyper',
};
export const ABOVE_TAB = 49;   // key code of the key left of 1, as Mutter defines it

// What a key code is on a US keyboard: labels and key names where nothing better is known.
const US_KEYS = {
    10: '1', 11: '2', 12: '3', 13: '4', 14: '5', 15: '6', 16: '7', 17: '8', 18: '9', 19: '0',
    20: 'minus', 21: 'equal', 49: 'grave',
};

export function parseAccel(accel) {
    const mods = new Set();
    const key = accel.replace(/<([^>]+)>/g, (_m, mod) => {
        mods.add(MODIFIERS[mod.toLowerCase()] ?? mod.toLowerCase());
        return '';
    });
    return {mods, key};
}

// The key code of a key given by its place ("0x14", "Above_Tab"), or null for a key name.
export function keycodeOf(key) {
    if (/^0x[0-9a-f]+$/i.test(key))
        return parseInt(key, 16);
    return key.toLowerCase() === 'above_tab' ? ABOVE_TAB : null;
}

/**
 * Ids of a key combination: one for its key name and one per key code it is on. Two
 * combinations are the same keys when they share an id. `resolve(name)` gives the key
 * codes of a key name in the current layout (null when unknown); without it, digits are
 * taken to be on the digit row, where they are in every layout.
 *
 * @returns {string[]} empty for an empty entry
 */
export function accelIds(accel, resolve = null) {
    const {mods, key} = parseAccel(accel);
    if (!key)
        return [];
    const prefix = `${[...mods].sort().join('+')}|`;
    const code = keycodeOf(key);
    if (code !== null)
        return [`${prefix}#${code}`];
    const name = key.toLowerCase();
    let codes = resolve?.(key) ?? null;
    if (!codes && /^[0-9]$/.test(name))
        codes = [name === '0' ? 19 : 9 + Number(name)];
    return [`${prefix}${name}`, ...(codes ?? []).map(c => `${prefix}#${c}`)];
}

const MOD_LABELS = {control: 'Ctrl', alt: 'Alt', super: 'Super', shift: 'Shift', meta: 'Meta', hyper: 'Hyper'};
const MOD_ORDER = ['super', 'shift', 'control', 'alt', 'meta', 'hyper'];
const KEY_LABELS = {
    left: '←', right: '→', up: '↑', down: '↓',
    minus: '-', equal: '=', grave: '`', apostrophe: "'", ssharp: 'ß',
    page_up: 'Page Up', page_down: 'Page Down', return: 'Enter', escape: 'Esc',
};
const DEAD_KEYS = {acute: '´', grave: '`', circumflex: '^', tilde: '~', diaeresis: '¨', cedilla: '¸'};

// A key name as printed on the key.
export function keyNameLabel(name) {
    const lower = name.toLowerCase();
    if (KEY_LABELS[lower])
        return KEY_LABELS[lower];
    if (lower.startsWith('dead_') && DEAD_KEYS[lower.slice(5)])
        return DEAD_KEYS[lower.slice(5)];
    return name.length === 1 ? name.toUpperCase() : name.replace(/_/g, ' ');
}

// `codeLabel(code)` names a key code in the user's layout; without it, a US keyboard's.
function keyLabel(key, codeLabel) {
    const code = keycodeOf(key);
    if (code === null)
        return keyNameLabel(key);
    return codeLabel?.(code) ?? keyNameLabel(US_KEYS[code] ?? key);
}

function modsLabel(mods) {
    return MOD_ORDER.filter(mod => mods.has(mod)).map(mod => MOD_LABELS[mod]);
}

export function formatAccel(accel, codeLabel = null) {
    const {mods, key} = parseAccel(accel);
    return [...modsLabel(mods), keyLabel(key, codeLabel)].join(' + ');
}

// "Super + ← → ↑ ↓", "Super + 1 … 0", "Super + W or Super + Q".
export function formatAccels(accels, codeLabel = null) {
    const groups = [];
    for (const accel of accels) {
        const {mods, key} = parseAccel(accel);
        if (!key)
            continue;
        const prefix = modsLabel(mods).join(' + ');
        let group = groups.find(g => g.prefix === prefix);
        if (!group) {
            group = {prefix, keys: []};
            groups.push(group);
        }
        group.keys.push(keyLabel(key, codeLabel));
    }
    return groups.map(({prefix, keys}) => {
        let list;
        if (keys.length > 4)
            list = `${keys[0]} … ${keys[keys.length - 1]}`;
        else if (keys.every(k => '←→↑↓'.includes(k)))
            list = keys.join(' ');
        else
            list = keys.join(' / ');
        return prefix ? `${prefix} + ${list}` : list;
    }).join(' or ');
}

// The keys a row uses, in order. `accelsOf(name)` reads the keybindings schema.
export function rowAccels(row, accelsOf, all = true) {
    return (row.bindings ?? []).flatMap(name => {
        const accels = accelsOf(name).filter(Boolean);
        return all || !row.variants ? accels : accels.slice(0, 1);
    });
}

export function rowKeysLabel(row, accelsOf, codeLabel = null) {
    return row.keys ?? formatAccels(rowAccels(row, accelsOf, false), codeLabel);
}

// --- GNOME's shortcuts ---------------------------------------------------------------

// Keys in saved-gnome-settings: plain for the window preferences (the extension's first
// overrides), "schema key" for everything else.
export function savedId(schema, key) {
    return schema === WM_PREFS ? key : `${schema} ${key}`;
}

export function splitSavedId(id) {
    const space = id.indexOf(' ');
    return space < 0 ? [WM_PREFS, id] : [id.slice(0, space), id.slice(space + 1)];
}

function lookupSchema(id) {
    return Gio.SettingsSchemaSource.get_default()?.lookup(id, true) ?? null;
}

/**
 * GNOME's shortcut lists as the user set them: values this extension changed are read
 * from `saved` (the saved-gnome-settings object).
 *
 * @returns {Array<{schema, key, summary, value: string[]}>}
 */
export function gnomeKeybindings(saved = {}) {
    const result = [];
    for (const id of GNOME_SCHEMAS) {
        const schema = lookupSchema(id);
        if (!schema)
            continue;
        const settings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys()) {
            const info = schema.get_key(key);
            if (info.get_value_type().dup_string() !== 'as' || NOT_KEYS.has(`${id} ${key}`))
                continue;
            let value = settings.get_strv(key);
            const own = saved[savedId(id, key)];
            if (own !== undefined) {
                try {
                    value = GLib.Variant.parse(null, own, null, null).deepUnpack();
                } catch {}
            }
            result.push({schema: id, key, summary: info.get_summary() ?? key, value});
        }
    }
    return result;
}

/**
 * What GNOME's shortcut lists become with `rows` switched on: GNOME shortcuts lose the
 * keys of those rows, and rows with `gnome` add theirs to the GNOME shortcut they name.
 *
 * @param {object[]} rows - the rows switched on
 * @param {Function} accelsOf - keys of a binding in the keybindings schema
 * @param {object[]} gnome - from gnomeKeybindings()
 * @param {Function} resolve - key codes of a key name in the current layout (see accelIds)
 * @returns {Map<string, string[]>} "schema key" -> new value, for every GNOME list
 */
export function planKeybindings(rows, accelsOf, gnome, resolve = null) {
    const owner = new Map();   // key id -> "schema key" of a GNOME target, or null
    const added = new Map();   // "schema key" -> keys to add
    for (const row of rows) {
        for (const name of row.bindings ?? []) {
            const target = row.gnome?.[name]?.join(' ') ?? null;
            for (const accel of accelsOf(name).filter(Boolean)) {
                for (const id of accelIds(accel, resolve))
                    owner.set(id, target);
                if (target)
                    added.set(target, [...added.get(target) ?? [], accel]);
            }
        }
    }
    const plan = new Map();
    for (const {schema, key, value} of gnome) {
        const target = `${schema} ${key}`;
        const own = added.get(target) ?? [];
        const ownIds = new Set(own.flatMap(accel => accelIds(accel, resolve)));
        const kept = value.filter(accel => {
            const ids = accelIds(accel, resolve);
            return !ids.length || ids.every(id => !owner.has(id) && !ownIds.has(id));
        });
        plan.set(target, [...own, ...kept]);
    }
    return plan;
}

// GNOME shortcuts a row takes its keys from: [{summary, accel}].
export function takenBy(row, accelsOf, gnome, resolve = null) {
    const own = new Set(Object.values(row.gnome ?? {}).map(target => target.join(' ')));
    const ids = new Set(rowAccels(row, accelsOf).flatMap(accel => accelIds(accel, resolve)));
    const taken = [];
    for (const {schema, key, summary, value} of gnome) {
        if (own.has(`${schema} ${key}`))
            continue;
        for (const accel of value) {
            if (accelIds(accel, resolve).some(id => ids.has(id)))
                taken.push({summary, accel});
        }
    }
    return taken;
}
