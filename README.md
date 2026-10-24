# Tiling Presets

Presets and App Presets for every GNOME workspace, from the top bar. The GNOME
counterpart of the Omarchy plugin *Workspace Presets*.

- **Presets** give a workspace a window limit (1–4 or none) and a layout:
  Auto, Side by side, Stacked, Master left, Master right, Columns, Grid, or
  Floating (GNOME's normal behaviour). New windows that don't fit move on to the
  next workspace with room.
- **App Presets** save the apps on a workspace and how they are arranged.
  Restore opens any missing apps and rebuilds the layout, with one click or
  once after login.
- **Workspace numbers** in the top bar, as on Omarchy: 1–5 are always shown
  (adjustable), more appear when those workspaces are in use. The active one is
  highlighted, empty ones are dimmed; click a number to switch, scroll to move along.

- **Windows:** a coloured border around the active window (colour, thickness and
  corner radius adjustable), minimize/maximize/close buttons in title bars, and a
  double-click on a title bar floats a tiled window or tiles it again.

Everything is optional in Settings and on by default. Requires GNOME Shell 51.

## Using it

- **Left-click** the top-bar button for the menu of the current workspace;
  **right-click** switches tiling off or on (the **Tiling** switch in Settings).
- **Drag** a tiled window onto another to swap their places. In the master
  layouts, resizing a window changes the master's share; elsewhere it snaps back.
- **Maximize**, fullscreen or *Always on Top* takes a window out of the layout
  until you undo it. Dialogs and fixed-size windows are never tiled.
- **Double-click a title bar** on a tiled workspace to float the window (centred,
  kept above the tiled ones; it is GNOME's *Always on Top*), and again to tile it.
  On floating workspaces a double-click maximizes and restores, as in GNOME.
  This works with apps that leave title bar double-clicks to GNOME (GTK and
  libadwaita apps, X11 apps with GNOME title bars); apps that handle them
  themselves (some browsers, Electron, Qt) maximize as before.
- **Title bar buttons** and the **double-click** use GNOME's own window settings
  (`button-layout`, `action-double-click-titlebar`). The extension sets them while it
  runs and puts your own values back when you turn an option or the extension off
  (also while the screen is locked). If you change one of them elsewhere meanwhile,
  your change is kept. Double-clicks are recognised only with the pointer on the
  title bar and no modifier key held, so keyboard shortcuts for maximizing
  vertically or horizontally are not taken for one.
- Workspaces without a preset of their own use the default preset from
  **Settings**, which starts as Floating, so nothing changes until you pick a layout.
- Works with GNOME's dynamic and fixed workspaces. With dynamic workspaces GNOME
  removes empty workspaces and renumbers the rest; for numbers that keep their
  place like on Omarchy, turn on **Fixed number of workspaces** in Settings (it is
  GNOME's own setting, also in Settings → Multitasking). With a fixed number, only
  those workspaces get numbers and overflow only uses them (a window stays where it
  opened when none has room), because adding a workspace would raise GNOME's count
  for good. Restoring an App Preset for a workspace past the fixed number adds it.
- Like the plugin, only newly opened windows trigger the overflow move; moving a
  window yourself always wins.

## Known limits

- Title bar double-clicks are recognised from how the window changes (the shell
  cannot see clicks inside app windows on Wayland). A shortcut bound to a single
  key without modifier, or an old X11 app maximizing itself in one direction,
  can be taken for one.
- An app that takes longer than 30 seconds to open during an App Preset restore
  may end up in the next App Preset being restored.

## Install

```sh
tools/build.sh
gnome-extensions install --force dist/tiling-presets@ubruckhaus.github.io.shell-extension.zip
```

Log out and back in (GNOME on Wayland only loads new extensions at login), then:

```sh
gnome-extensions enable tiling-presets@ubruckhaus.github.io
```

## Development

- `gjs -m tests/layouts.test.js` tests the layout geometry.
- `tools/headless-test.sh <scenario>` runs the packaged extension in a throwaway
  headless GNOME Shell with its own D-Bus, dconf and data folders, so your session
  is untouched. Scenarios in `tools/scenarios/`: `tiling` (limits, overflow,
  disable/enable), `restore` (App Presets at login), `menu` (screenshots of the
  menu and settings), `input` (clicks and drag-to-swap with a virtual pointer),
  `numbers` (workspace numbers; `WINDOWS=7 SPACING=0.5` for more than five).
  `windows` (border, double-click floating, Super+Left, GNOME settings restored),
  `plain` (double-click on a floating workspace; `DBL=false` for GNOME's own),
  `extra` (master proportion after disable/enable, App Preset restore un-minimizing).
  Screenshots go to `dist/screenshots/`.
  `FIXED=1` runs any scenario with GNOME's fixed workspaces instead of dynamic ones.
- `gsettings set org.gnome.shell.extensions.tiling-presets debug true` writes the
  extension's decisions to the journal (`journalctl -f -o cat /usr/bin/gnome-shell`).
- `tools/make-icons.py` regenerates the layout icons.
