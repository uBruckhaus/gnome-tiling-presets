// Reading and writing presets in GSettings. Shared by the extension and the preferences.
// Workspaces are keyed by their number as shown to the user (index + 1).

import {LAYOUTS, LIMITS} from './layouts.js';

export function readJSON(settings, key) {
    try {
        const value = JSON.parse(settings.get_string(key));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

export function writeJSON(settings, key, value) {
    settings.set_string(key, JSON.stringify(value));
}

export function normalizePreset(preset, fallback = {layout: 'floating', limit: 2}) {
    const layout = LAYOUTS.includes(preset?.layout) ? preset.layout : fallback.layout;
    const limit = LIMITS.includes(preset?.limit) ? preset.limit : fallback.limit;
    return {layout, limit};
}

export function defaultPreset(settings) {
    return normalizePreset({
        layout: settings.get_string('default-layout'),
        limit: settings.get_int('default-limit'),
    });
}

// The preset that applies to a workspace; `own` tells whether it has one of its own.
export function presetFor(settings, number) {
    const fallback = defaultPreset(settings);
    const own = readJSON(settings, 'workspace-presets')[number];
    if (!own)
        return {...fallback, own: false};
    return {...normalizePreset(own, fallback), own: true};
}

export function setWorkspacePreset(settings, number, preset) {
    const presets = readJSON(settings, 'workspace-presets');
    if (preset)
        presets[number] = normalizePreset(preset, presetFor(settings, number));
    else
        delete presets[number];
    writeJSON(settings, 'workspace-presets', presets);
}

export function appPresets(settings) {
    return readJSON(settings, 'app-presets');
}

export function setAppPreset(settings, number, data) {
    const presets = appPresets(settings);
    if (data)
        presets[number] = data;
    else
        delete presets[number];
    writeJSON(settings, 'app-presets', presets);
}
