# Two Ptyxis windows (it may open them maximized).
$S set org.gnome.shell.extensions.tiling-presets default-layout side-by-side
ptyxis --new-window >/dev/null 2>&1 &
sleep 3; ptyxis --new-window >/dev/null 2>&1 &
sleep 6
