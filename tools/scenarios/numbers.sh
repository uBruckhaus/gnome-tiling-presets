# Limit 1: every further window overflows to the next workspace. WINDOWS sets how many.
for i in $(seq ${WINDOWS:-2}); do
    alacritty -e sleep 40 >/dev/null 2>&1 &
    sleep ${SPACING:-1.2}
done
sleep $((16 - ${WINDOWS:-2}))
