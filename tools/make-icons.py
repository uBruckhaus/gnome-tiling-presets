#!/usr/bin/env python3
"""Writes the symbolic layout icons (16x16) into the extension's icons/ folder."""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "tiling-presets@ubruckhaus.github.io" / "icons"
FILL = "#2e3436"


def rect(x, y, w, h):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="1" fill="{FILL}"/>'


def outline(x, y, w, h):
    return (f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{w - 1}" height="{h - 1}" rx="1" '
            f'fill="none" stroke="{FILL}" stroke-width="1"/>')


ICONS = {
    "layout-floating": [outline(1, 2, 9, 8), rect(6, 6, 9, 8)],
    "layout-auto": [rect(1, 2, 6, 12), outline(8, 2, 7, 5), outline(8, 8, 7, 6)],
    "layout-side-by-side": [rect(1, 2, 6.5, 12), rect(8.5, 2, 6.5, 12)],
    "layout-stacked": [rect(1, 2, 14, 5.5), rect(1, 8.5, 14, 5.5)],
    "layout-master-left": [rect(1, 2, 8, 12), rect(10, 2, 5, 5.5), rect(10, 8.5, 5, 5.5)],
    "layout-master-right": [rect(1, 2, 5, 5.5), rect(1, 8.5, 5, 5.5), rect(7, 2, 8, 12)],
    "layout-columns": [rect(1, 2, 4, 12), rect(6, 2, 4, 12), rect(11, 2, 4, 12)],
    "layout-grid": [rect(1, 2, 6.5, 5.5), rect(8.5, 2, 6.5, 5.5), rect(1, 8.5, 6.5, 5.5), rect(8.5, 8.5, 6.5, 5.5)],
    "paused": [outline(1, 2, 14, 12), rect(5, 5, 2, 6), rect(9, 5, 2, 6)],
}

OUT.mkdir(parents=True, exist_ok=True)
for name, shapes in ICONS.items():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
           + "".join(shapes) + "</svg>\n")
    (OUT / f"{name}-symbolic.svg").write_text(svg)
print(f"{len(ICONS)} icons written to {OUT}")
