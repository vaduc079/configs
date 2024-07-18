#!/usr/bin/env sh

isEnabled=$(hyprctl getoption animations:enabled | awk 'NR==1{print $2}')
if [ "$isEnabled" = 1 ]; then
      hyprctl --batch "\
        keyword animations:enabled 0;\
        keyword decoration:rounding 0"
else
      hyprctl --batch "\
        keyword animations:enabled 1;\
        keyword decoration:rounding 4"
fi
