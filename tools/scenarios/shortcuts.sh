alacritty -e sleep 60 >/dev/null 2>&1 &
sleep 1; gnome-calculator >/dev/null 2>&1 &
sleep 4
echo "GNOME while on:"; gnome_keys
sleep 26
gnome-extensions disable $UUID; sleep 1
echo "GNOME after disable:"; gnome_keys
echo "saved=$($S get org.gnome.shell.extensions.tiling-presets saved-gnome-settings)"
