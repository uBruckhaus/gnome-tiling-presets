// Run: gjs -m tests/layouts.test.js
import System from 'system';
import {computeLayout, resolveLayout, slotAt, LAYOUTS} from '../tiling-presets@ubruckhaus.github.io/layouts.js';

let failures = 0;
function check(name, condition) {
    if (!condition) {
        failures++;
        print(`FAIL ${name}`);
    }
}

const area = {x: 0, y: 32, width: 1920, height: 1048};
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
const inside = r => r.x >= area.x && r.y >= area.y &&
    r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;

for (const layout of LAYOUTS.filter(l => l !== 'floating')) {
    for (const gap of [0, 8]) {
        for (let n = 1; n <= 9; n++) {
            const rects = computeLayout(layout, n, area, gap);
            const tag = `${layout} n=${n} gap=${gap}`;
            check(`${tag} count`, rects.length === n);
            check(`${tag} inside`, rects.every(inside));
            check(`${tag} positive`, rects.every(r => r.width > 0 && r.height > 0));
            check(`${tag} integers`, rects.every(r => [r.x, r.y, r.width, r.height].every(Number.isInteger)));
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++)
                    check(`${tag} overlap ${i}/${j}`, !overlaps(rects[i], rects[j]));
            }
            // Without gaps the windows cover the whole area.
            if (gap === 0) {
                const covered = rects.reduce((sum, r) => sum + r.width * r.height, 0);
                check(`${tag} covers`, covered === area.width * area.height);
            }
        }
    }
}

// No limit: many windows still get positive sizes, and halving stops at a sensible size.
for (const layout of ['side-by-side', 'stacked', 'auto', 'master-left', 'columns', 'grid']) {
    for (const n of [12, 24, 60]) {
        const rects = computeLayout(layout, n, area, 8);
        check(`${layout} n=${n} positive`, rects.length === n && rects.every(r => r.width > 0 && r.height > 0));
    }
}
for (const n of [10, 24]) {
    const rects = computeLayout('side-by-side', n, area, 8);
    check(`side-by-side n=${n} no overlap`, rects.every((a, i) => rects.every((b, j) => i >= j || !overlaps(a, b))));
}

check('floating has no rects', computeLayout('floating', 3, area).length === 0);
check('auto 2', resolveLayout('auto', 2) === 'side-by-side');
check('auto 3', resolveLayout('auto', 3) === 'master-left');
check('auto 4', resolveLayout('auto', 4) === 'grid');

const [left, right] = computeLayout('side-by-side', 2, area);
check('side-by-side halves', left.width === 960 && right.x === 960 && left.height === area.height);
const [top, bottom] = computeLayout('stacked', 2, area);
check('stacked halves', top.height === 524 && bottom.y === 32 + 524);
const mr = computeLayout('master-right', 3, area, 0, 0.6);
check('master-right on the right', mr[0].x > mr[1].x && mr[0].width === 1152);
const ml = computeLayout('master-left', 3, area, 0, 0.6);
check('master-left on the left', ml[0].x === 0 && ml[0].width === 1152 && ml[1].x === 1152);
const g = computeLayout('grid', 4, area);
check('grid 2x2', g[0].width === 960 && g[2].y === 32 + 524);
check('slotAt finds right', slotAt(computeLayout('side-by-side', 2, area), 1500, 500) === 1);
check('slotAt misses', slotAt(computeLayout('side-by-side', 2, area), 5000, 500) === -1);

print(failures ? `${failures} failure(s)` : 'all layout tests passed');
if (failures)
    System.exit(1);
