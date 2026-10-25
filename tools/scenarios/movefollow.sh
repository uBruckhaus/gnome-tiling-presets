for t in ${WINDOWS:-a b}; do
    alacritty --title "$t" -e sleep 40 >/dev/null 2>&1 &
    sleep 2
done
sleep 14
