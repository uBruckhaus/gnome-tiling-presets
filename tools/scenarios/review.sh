echo "button-layout before (user value, empty = unset): '$(dconf read /org/gnome/desktop/wm/preferences/button-layout)'"
alacritty -e sleep 60 >/dev/null 2>&1 &
sleep 1; gnome-calculator >/dev/null 2>&1 &
sleep 5
echo "button-layout while on: '$(dconf read /org/gnome/desktop/wm/preferences/button-layout)'"
sleep 2
gnome-extensions disable $UUID; sleep 1
echo "button-layout after disable (must be empty again): '$(dconf read /org/gnome/desktop/wm/preferences/button-layout)'"
echo "window-state saved: $($S get org.gnome.shell.extensions.tiling-presets window-state)"
gnome-extensions enable $UUID
sleep 3
echo "window-state after enable (cleared): $($S get org.gnome.shell.extensions.tiling-presets window-state)"
