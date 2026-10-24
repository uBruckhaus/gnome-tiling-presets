# Default layout Auto, limit 3: three windows tile, the fourth moves to workspace 2.
$S set org.gnome.shell.extensions.tiling-presets default-layout auto
$S set org.gnome.shell.extensions.tiling-presets default-limit 3
sleep 1
for i in 1 2 3 4; do
    alacritty --title "term$i" -e sleep 30 >/dev/null 2>&1 &
    sleep 2
done
sleep 2
echo "--- switch workspace 1 to grid"
$S set org.gnome.shell.extensions.tiling-presets workspace-presets '{"1":{"layout":"grid","limit":4}}'
sleep 2
echo "--- disable / enable (like locking and unlocking)"
gnome-extensions disable $UUID; sleep 1; gnome-extensions enable $UUID; sleep 2
gnome-extensions info $UUID | grep State
alacritty --title term5 -e sleep 20 >/dev/null 2>&1 &
sleep 2
