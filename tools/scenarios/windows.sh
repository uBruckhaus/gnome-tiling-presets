alacritty -e sleep 60 >/dev/null 2>&1 &
sleep 1; gnome-calculator >/dev/null 2>&1 &
sleep 10
echo "GNOME while enabled: $(gsettings get org.gnome.desktop.wm.preferences button-layout) $(gsettings get org.gnome.desktop.wm.preferences action-double-click-titlebar)"
sleep 20
gnome-extensions disable $UUID; sleep 1
echo "GNOME after disable:"  $(gsettings get org.gnome.desktop.wm.preferences button-layout)
echo "--- changed elsewhere while enabled"
gnome-extensions enable $UUID; sleep 2
gsettings set org.gnome.desktop.wm.preferences button-layout 'close:'
sleep 1; gnome-extensions disable $UUID; sleep 1
echo "GNOME after external change + disable: $(gsettings get org.gnome.desktop.wm.preferences button-layout) $(gsettings get org.gnome.desktop.wm.preferences action-double-click-titlebar) saved=$($S get org.gnome.shell.extensions.tiling-presets saved-gnome-settings)"
