for t in a b; do
    alacritty --title "$t" -e sleep 40 >/dev/null 2>&1 &
    sleep 2
done
sleep 14
$S set org.gnome.shell.extensions.tiling-presets focus-follows-mouse true; sleep 1
echo "GNOME focus-mode while on: $(gsettings get org.gnome.desktop.wm.preferences focus-mode)"
gnome-extensions disable $UUID; sleep 1
echo "GNOME focus-mode after disable: $(gsettings get org.gnome.desktop.wm.preferences focus-mode)"
