// Run: gjs -m tests/keys.test.js
// The schema defaults are read from the XML, so no compiled schema is needed.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {
    ROWS, ROW_IDS, WM_KEYS, accelIds, formatAccels, keyNameLabel, planKeybindings, rowKeysLabel, takenBy,
} from '../tiling-presets@ubruckhaus.github.io/keys.js';

let failures = 0;
function check(name, condition) {
    if (!condition) {
        failures++;
        print(`FAIL ${name}`);
    }
}

const dir = GLib.path_get_dirname(GLib.path_get_dirname(System.programPath));
const xml = new TextDecoder().decode(Gio.File.new_for_path(
    `${dir}/tiling-presets@ubruckhaus.github.io/schemas/org.gnome.shell.extensions.tiling-presets.gschema.xml`)
    .load_contents(null)[1]);
const unescape = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const defaults = new Map();
for (const [, name, value] of xml.matchAll(/<key name="([a-z0-9-]+)" type="as">\s*<default>([^<]*)<\/default>/g))
    defaults.set(name, JSON.parse(unescape(value).replace(/'/g, '"')));
const accelsOf = name => defaults.get(name) ?? [];

// Every binding of the table is in the schema, and no id is used twice.
for (const row of ROWS) {
    for (const name of row.bindings ?? [])
        check(`schema has ${name}`, defaults.has(name));
    check(`${row.id} has keys`, Boolean(row.keys) || rowKeysLabel(row, accelsOf).length > 0);
}
check('row ids unique', new Set(ROW_IDS).size === ROW_IDS.length);
const allAccels = ROWS.flatMap(row => (row.bindings ?? []).flatMap(accelsOf)).flatMap(a => accelIds(a));
check('no two Omarchy shortcuts share keys', new Set(allAccels).size === allAccels.length);

// Keys that differ between layouts are bound by their place, not by a character.
const layoutKeys = ROWS.flatMap(row => (row.bindings ?? []).flatMap(accelsOf))
    .filter(a => /(ssharp|dead_|[>][0-9]$)/.test(a));
check(`no layout-specific keys: ${layoutKeys}`, layoutKeys.length === 0);

// Spellings of the same keys.
const same = (a, b) => accelIds(a).some(id => accelIds(b).includes(id));
check('Primary is Control', same('<Primary><Alt>Tab', '<Control><Alt>Tab'));
check('modifier order', same('<Shift><Super>Tab', '<Super><Shift>Tab'));
check('letter case', same('<Super>L', '<Super>l'));
check('Shift matters', !same('<Super>Tab', '<Super><Shift>Tab'));
check('digit is on the digit row', same('<Super>1', '<Super>0x0a') && same('<Super>0', '<Super>0x13'));
check('Above_Tab is key 49', same('<Super>Above_Tab', '<Super>0x31'));
check('empty', accelIds('').length === 0);
// With the layout known: German minus is not the key right of 0, US minus is.
const de = name => ({minus: [61], equal: [19], ssharp: [20], dead_acute: [21]})[name] ?? null;
const us = name => ({minus: [20], equal: [21]})[name] ?? null;
check('de: Super+Alt+minus is not key 20', !accelIds('<Super><Alt>minus', de).some(id => accelIds('<Super><Alt>0x14').includes(id)));
check('us: Super+Alt+minus is key 20', accelIds('<Super><Alt>minus', us).some(id => accelIds('<Super><Alt>0x14').includes(id)));

// Labels: without a layout as on a US keyboard, with one in its characters.
const label = (id, codeLabel = null) => rowKeysLabel(ROWS.find(row => row.id === id), accelsOf, codeLabel);
const german = code => ({20: 'ß', 21: '´', 49: '^'})[code] ?? null;
check(`workspaces label: ${label('workspace-switch')}`, label('workspace-switch') === 'Super + 1 … 0');
check(`focus label: ${label('focus')}`, label('focus') === 'Super + ← → ↑ ↓');
check(`close label: ${label('close')}`, label('close') === 'Super + W / Q');
check(`resize label: ${label('resize-width')}`, label('resize-width') === 'Super + - / =');
check(`resize label de: ${label('resize-width', german)}`, label('resize-width', german) === 'Super + ß / ´');
check(`scratchpad label: ${label('scratchpad')}`, label('scratchpad') === 'Super + S / `');
check(`scratchpad label de: ${label('scratchpad', german)}`, label('scratchpad', german) === 'Super + S / ^');
check(`next label: ${label('workspace-next')}`, label('workspace-next') === 'Super + Tab or Super + Shift + Tab');
check('formatAccels mods', formatAccels(['<Control><Alt>Delete']) === 'Ctrl + Alt + Delete');
check('dead key label', keyNameLabel('dead_circumflex') === '^' && keyNameLabel('dead_acute') === '´');

// Planning against GNOME's defaults (a small excerpt).
const gnome = [
    {schema: WM_KEYS, key: 'switch-applications', summary: 'Switch applications', value: ['<Super>Tab', '<Alt>Tab']},
    {schema: WM_KEYS, key: 'switch-windows', summary: 'Switch windows', value: []},
    {schema: WM_KEYS, key: 'switch-to-workspace-right', summary: 'Move to workspace on the right',
        value: ['<Super>Page_Down', '<Control><Alt>Right']},
    {schema: WM_KEYS, key: 'close', summary: 'Close window', value: ['<Alt>F4']},
    {schema: WM_KEYS, key: 'switch-group', summary: 'Switch windows of an app', value: ['<Super>Above_Tab', '<Alt>Above_Tab']},
    {schema: 'org.gnome.settings-daemon.plugins.media-keys', key: 'screensaver', summary: 'Lock screen', value: ['<Super>l']},
    {schema: 'org.gnome.shell.keybindings', key: 'toggle-quick-settings', summary: 'Show the quick settings', value: ['<Super>s']},
    {schema: 'org.gnome.settings-daemon.plugins.media-keys', key: 'help', summary: 'Help', value: ['', '<Super>F1']},
    {schema: 'org.gnome.shell.keybindings', key: 'switch-to-application-1', summary: 'Switch to application 1', value: ['<Super>1']},
    {schema: 'org.gnome.settings-daemon.plugins.media-keys', key: 'magnifier-zoom-out', summary: 'Zoom out', value: ['<Alt><Super>minus']},
];
const rows = ids => ROWS.filter(row => ids.includes(row.id));
const plan = (ids, resolve = null) => planKeybindings(rows(ids), accelsOf, gnome, resolve);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let p = plan([]);
check('nothing on: nothing changes', gnome.every(g => equal(p.get(`${g.schema} ${g.key}`), g.value)));

p = plan(['workspace-next']);
check('Super+Tab leaves the app switcher', equal(p.get(`${WM_KEYS} switch-applications`), ['<Alt>Tab']));
check('Super+Tab joins GNOME\'s next workspace, first',
    equal(p.get(`${WM_KEYS} switch-to-workspace-right`), ['<Super>Tab', '<Super>Page_Down', '<Control><Alt>Right']));

p = plan(['workspace-next', 'windows-next']);
check('app switcher has no keys left', equal(p.get(`${WM_KEYS} switch-applications`), []));
check('Alt+Tab switches windows', equal(p.get(`${WM_KEYS} switch-windows`), ['<Alt>Tab']));

p = plan(['close']);
check('close keeps Alt+F4', equal(p.get(`${WM_KEYS} close`), ['<Super>w', '<Super>q', '<Alt>F4']));

p = plan(['cycle-layout']);
check('Super+L leaves the lock screen', equal(p.get('org.gnome.settings-daemon.plugins.media-keys screensaver'), []));
p = plan(['cycle-layout', 'lock-screen']);
check('lock moves to Super+Ctrl+L', equal(p.get('org.gnome.settings-daemon.plugins.media-keys screensaver'), ['<Super><Control>l']));

p = plan(['scratchpad']);
check('Super+S leaves quick settings', equal(p.get('org.gnome.shell.keybindings toggle-quick-settings'), []));
check('Super+^ leaves Above_Tab', equal(p.get(`${WM_KEYS} switch-group`), ['<Alt>Above_Tab']));
check('empty entries stay', equal(p.get('org.gnome.settings-daemon.plugins.media-keys help'), ['', '<Super>F1']));

p = plan(['workspace-switch']);
check('Super+1 leaves the dock app', equal(p.get('org.gnome.shell.keybindings switch-to-application-1'), []));
check('de: resizing keeps zoom out', equal(plan(['resize-width'], de).get('org.gnome.settings-daemon.plugins.media-keys magnifier-zoom-out'), ['<Alt><Super>minus']));
check('us: resizing takes zoom out', equal(plan(['resize-width'], us).get('org.gnome.settings-daemon.plugins.media-keys magnifier-zoom-out'), []));

// What the settings page says a row takes.
const taken = id => takenBy(ROWS.find(row => row.id === id), accelsOf, gnome).map(t => t.summary);
check('scratchpad takes two', equal(taken('scratchpad'), ['Switch windows of an app', 'Show the quick settings']));
check('close takes nothing of its own', equal(taken('close'), []));
check('next workspace takes the app switcher', equal(taken('workspace-next'), ['Switch applications']));

print(failures ? `${failures} failure(s)` : 'all key tests passed');
if (failures)
    System.exit(1);
