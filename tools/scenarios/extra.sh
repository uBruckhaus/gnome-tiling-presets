alacritty -e sleep 60 >/dev/null 2>&1 &
sleep 1; gnome-calculator >/dev/null 2>&1 &
sleep 7
gnome-extensions disable $UUID; sleep 1; gnome-extensions enable $UUID
sleep 6
