# The extension's settings float centred above a full side-by-side workspace (limit 2):
# not tiled, not moved on to the next workspace.
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"side-by-side","limit":2}}'
sleep 1
for i in 1 2; do
    alacritty --title "term$i" -e sleep 40 >/dev/null 2>&1 &
    sleep 2
done
gnome-extensions prefs $UUID
sleep 4
sleep 10
