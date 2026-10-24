// Layout geometry. Pure functions, no GNOME imports, so the tests run in plain gjs.

export const LAYOUTS = [
    'floating', 'auto', 'side-by-side', 'stacked',
    'master-left', 'master-right', 'columns', 'grid',
];

// 0 means no limit.
export const LIMITS = [1, 2, 3, 4, 0];

export const MASTER_LAYOUTS = ['master-left', 'master-right'];

export function isTilingLayout(layout) {
    return LAYOUTS.includes(layout) && layout !== 'floating';
}

// Auto picks a layout from the number of windows.
export function resolveLayout(layout, count) {
    if (layout !== 'auto')
        return layout;
    if (count <= 2)
        return 'side-by-side';
    if (count === 3)
        return 'master-left';
    return 'grid';
}

// Splits `length` into `count` parts with `gap` between them, without rounding gaps.
function spans(start, length, count, gap) {
    const result = [];
    const step = (length + gap) / count;
    for (let i = 0; i < count; i++) {
        const from = start + Math.round(i * step);
        const to = start + Math.round((i + 1) * step) - gap;
        result.push([from, to - from]);
    }
    return result;
}

function split(area, count, gap, horizontal) {
    if (horizontal) {
        return spans(area.x, area.width, count, gap)
            .map(([x, width]) => ({x, y: area.y, width, height: area.height}));
    }
    return spans(area.y, area.height, count, gap)
        .map(([y, height]) => ({x: area.x, y, width: area.width, height}));
}

// Cuts `area` in two; `ratio` is the share of the first part.
function halve(area, horizontal, gap, ratio = 0.5) {
    if (horizontal) {
        const first = Math.round((area.width - gap) * ratio);
        return [
            {x: area.x, y: area.y, width: first, height: area.height},
            {x: area.x + first + gap, y: area.y, width: area.width - first - gap, height: area.height},
        ];
    }
    const first = Math.round((area.height - gap) * ratio);
    return [
        {x: area.x, y: area.y, width: area.width, height: first},
        {x: area.x, y: area.y + first + gap, width: area.width, height: area.height - first - gap},
    ];
}

const MIN_SIZE = 120; // px; below this dwindle stops halving and shares the rest evenly

// Each window takes half of the space left, alternating direction (like Hyprland's dwindle).
function dwindle(area, count, gap, horizontalFirst) {
    const rects = [];
    let rest = area;
    let horizontal = horizontalFirst;
    for (let i = 0; i < count - 1; i++) {
        const length = horizontal ? rest.width : rest.height;
        if ((length - gap) / 2 < MIN_SIZE) {
            const wide = rest.width >= rest.height;
            return [...rects, ...split(rest, count - i, gap, wide)];
        }
        const [first, second] = halve(rest, horizontal, gap);
        rects.push(first);
        rest = second;
        horizontal = !horizontal;
    }
    rects.push(rest);
    return rects;
}

function master(area, count, gap, ratio, right) {
    if (right) {
        const [stack, main] = halve(area, true, gap, 1 - ratio);
        return [main, ...split(stack, count - 1, gap, false)];
    }
    const [main, stack] = halve(area, true, gap, ratio);
    return [main, ...split(stack, count - 1, gap, false)];
}

function grid(area, count, gap) {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const rects = [];
    split(area, rows, gap, false).forEach((row, r) => {
        const inRow = Math.min(columns, count - r * columns);
        rects.push(...split(row, inRow, gap, true));
    });
    return rects;
}

/**
 * The frame rectangles for `count` windows, in window order.
 *
 * @param {string} layout - one of LAYOUTS except 'floating'
 * @param {number} count - number of windows
 * @param {{x, y, width, height}} area - the monitor's work area
 * @param {number} gap - space around and between windows
 * @param {number} ratio - the master window's share in master layouts
 */
export function computeLayout(layout, count, area, gap = 0, ratio = 0.5) {
    if (count <= 0 || !isTilingLayout(layout))
        return [];
    const inner = {
        x: area.x + gap,
        y: area.y + gap,
        width: Math.max(1, area.width - 2 * gap),
        height: Math.max(1, area.height - 2 * gap),
    };
    if (count === 1)
        return [inner];
    let rects;
    switch (resolveLayout(layout, count)) {
    case 'stacked':
        rects = dwindle(inner, count, gap, false);
        break;
    case 'master-left':
        rects = master(inner, count, gap, ratio, false);
        break;
    case 'master-right':
        rects = master(inner, count, gap, ratio, true);
        break;
    case 'columns':
        rects = split(inner, count, gap, true);
        break;
    case 'grid':
        rects = grid(inner, count, gap);
        break;
    default:
        rects = dwindle(inner, count, gap, true);
    }
    // With very many windows (no limit) the slots can get smaller than the gaps.
    return rects.map(r => ({...r, width: Math.max(1, r.width), height: Math.max(1, r.height)}));
}

// Index of the rectangle containing the point, or -1.
export function slotAt(rects, x, y) {
    return rects.findIndex(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

export function clampRatio(ratio) {
    return Math.min(0.85, Math.max(0.15, ratio));
}
