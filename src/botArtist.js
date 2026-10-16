import * as THREE from 'three';
import { STROKE } from './config.js';
import { inNoDrawZone } from './arena.js';
import { polylineLength } from './strokes.js';

// AI players for the drawing phase: each plans a handful of shapes on its side of the arena and
// "draws" them with an animated, name-tagged cursor - like the other players in a lobby.

const UP = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector3();
// Seconds between live rebuilds of a stroke a bot is drawing: often enough that the stroke stays about 1 m
// behind its cursor. Each one re-sweeps the whole stroke, but 19 drawing bots still cost only ~15 ms per second
// in WebKit, and a slower rate made the strokes visibly lag and grow in chunks. The final rebuild is exact.
const REBUILD_EVERY = 0.07;

function densify(pts, step = 0.45) {
    const out = [pts[0].clone()];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
        for (let j = 1; j <= n; j++) out.push(a.clone().lerp(b, j / n));
    }
    return out;
}

// Local frame running from a team's base toward the action: P(u, x, y).
class Lane {
    constructor(origin, along, across, uMax) {
        this.origin = origin;
        this.along = along;
        this.across = across;
        this.uMax = uMax;
    }

    at(u, x, y) {
        return this.origin
            .clone()
            .addScaledVector(this.along, u)
            .addScaledVector(this.across, x)
            .addScaledVector(UP, y);
    }
}

const LETTERS = {
    S: [[0.9, 0.85], [0.6, 1], [0.2, 0.95], [0.05, 0.75], [0.2, 0.55], [0.5, 0.5], [0.8, 0.45], [0.95, 0.25],
        [0.8, 0.05], [0.4, 0], [0.1, 0.15]],
    Z: [[0, 1], [1, 1], [0, 0], [1, 0]],
    N: [[0, 0], [0, 1], [1, 0], [1, 1]],
    V: [[0, 1], [0.5, 0], [1, 1]],
    W: [[0, 1], [0.25, 0], [0.5, 0.7], [0.75, 0], [1, 1]],
    M: [[0, 0], [0, 1], [0.5, 0.4], [1, 1], [1, 0]],
    4: [[0.7, 0], [0.7, 1], [0, 0.35], [1, 0.35]],
    7: [[0, 1], [1, 1], [0.35, 0]],
    2: [[0.05, 0.75], [0.3, 1], [0.75, 0.95], [0.9, 0.7], [0.6, 0.4], [0, 0], [1, 0]],
    L: [[0, 1], [0, 0], [0.8, 0]],
};

function circle2D(r, n = 44, start = 0) {
    const out = [];
    for (let i = 0; i <= n; i++) {
        const a = start + (i / n) * Math.PI * 2;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
}

function blob2D(rng, r) {
    const p1 = rng.range(0, 6);
    const p2 = rng.range(0, 6);
    const out = [];
    for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const rr = r * (1 + 0.16 * Math.sin(3 * a + p1) + 0.09 * Math.sin(5 * a + p2));
        out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    out[out.length - 1] = out[0];
    return out;
}

function rect2D(w, h) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
}

function heart2D(size) {
    const out = [];
    for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        out.push([(x / 32) * size + 0.5 * size, (y / 32) * size + 0.5 * size]);
    }
    return out;
}

function star2D(size) {
    const out = [];
    for (let i = 0; i <= 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = (i % 2 === 0 ? 0.5 : 0.22) * size;
        out.push([0.5 * size + Math.cos(a) * r, 0.5 * size + Math.sin(a) * r]);
    }
    return out;
}

// ---------- recipes: each returns a stroke description or null ----------

function sideWalk(rng, lane) {
    const s = rng.sign();
    const x = s * 3.05;
    const u0 = rng.range(1, lane.uMax * 0.45);
    const h = rng.range(2.8, 5.2);
    const run = h * rng.range(1.6, 2.1);
    const flat = rng.range(5, 11);
    const prof = [[0, -0.25], [1.2, -0.25], [1.2 + run, h], [1.2 + run + flat, h]];
    if (rng.chance(0.65)) prof.push([2.4 + 2 * run + flat, -0.25]);
    const pts = prof.map(([u, y]) => lane.at(u0 + u, x, y));
    return { tool: 'ribbon', planeNormal: lane.across.clone(), points: densify(pts) };
}

function hill(rng, lane) {
    const l = rng.range(12, 18);
    const h = l * rng.range(0.13, 0.2);
    const u0 = rng.range(2, lane.uMax - l * 0.5);
    const pts = [];
    for (let i = 0; i <= 36; i++) {
        const t = i / 36;
        pts.push(lane.at(u0 + t * l, 0, -0.25 + h * Math.sin(Math.PI * t)));
    }
    return { tool: 'ribbon', planeNormal: lane.across.clone(), points: pts };
}

function slab(rng, lane) {
    const s = rng.sign();
    const kind = rng.weighted([
        [3, 'side'],
        [3, 'raised'],
        [1, 'high'],
    ]);
    const r = rng.range(2.4, 4.4);
    let x;
    let y;
    // y is the platform's top: side extensions sit flush with the bridge
    if (kind === 'side') {
        x = s * (1.5 + r - 0.5);
        y = 0;
    } else if (kind === 'raised') {
        x = s * rng.range(4.5, 11);
        y = rng.pick([2.2, 3.6, 4.7]);
    } else {
        x = s * rng.range(3, 14);
        y = rng.range(6, 10);
    }
    const u = rng.range(r + 1, lane.uMax);
    // side extensions are rectangles flush with the bridge so there are no gaps to fall through
    const shape =
        kind === 'side'
            ? rect2D(r * 2, r * rng.range(1.6, 2.6))
            : rng.weighted([
                  [2, () => circle2D(r)],
                  [2, () => rect2D(r * 2, r * rng.range(1.4, 2.2))],
                  [2, () => blob2D(rng, r)],
              ])();
    if (kind === 'side') x = s * (1.5 - 0.6 + r);
    const pts = shape.map(([a, b]) => lane.at(u + b, x + a, y));
    return { tool: 'ground', planeY: y, points: densify(pts) };
}

function coverWall(rng, lane, ctx) {
    if (rng.chance(0.55)) {
        const s = rng.sign();
        const u0 = rng.range(2, lane.uMax - 4);
        const len = rng.range(3, 5);
        const pts = [lane.at(u0, s * 1.15, 0), lane.at(u0 + len, s * 1.15, 0)];
        return { tool: 'wall', planeY: 0, points: densify(pts) };
    }
    // cover on the base top, away from the spawn ring
    const half = ctx.baseHalf - 1.6;
    const u = -rng.range(1.4, 2.6);
    const x0 = rng.sign() * rng.range(2.5, half - 3);
    const pts = [lane.at(u, x0 - 1.6, 0), lane.at(u - rng.range(-0.8, 0.8), x0 + 1.6, 0)];
    return { tool: 'wall', planeY: 0, points: densify(pts) };
}

function baseWall(rng, lane, ctx) {
    const h = ctx.baseHalf;
    if (ctx.layout === 'radial') {
        const span = rng.range(1.6, 2.4);
        const mid = Math.PI + rng.range(-0.5, 0.5);
        const pts = [];
        for (let i = 0; i <= 30; i++) {
            const a = mid - span / 2 + (i / 30) * span;
            pts.push(lane.at(-h + Math.cos(a) * (h - 0.8), Math.sin(a) * (h - 0.8), 0));
        }
        return { tool: 'wall', planeY: 0, width: 2.0, points: pts };
    }
    // crenellated wall along the base front edge, leaving the bridge entrance open
    const s = rng.sign();
    const pts = [];
    const x0 = s * 2.4;
    const x1 = s * (h - 0.5);
    const seg = 1.3;
    const steps = Math.floor(Math.abs(x1 - x0) / seg);
    for (let i = 0; i <= steps; i++) {
        const x = x0 + s * i * seg;
        const y = i % 2 === 0 ? 1.0 : 1.75;
        pts.push(lane.at(-0.7, x, y));
        if (i < steps) pts.push(lane.at(-0.7, x + s * seg, y));
    }
    return {
        tool: 'ribbon',
        planeNormal: lane.along.clone(),
        width: 0.7,
        thickness: 1.8,
        smooth: false,
        points: densify(pts, 0.4),
    };
}

// Flat detour beside the bridge: leaves it, bulges out and comes back (a GROUND path).
function path(rng, lane) {
    const s = rng.sign();
    const len = rng.range(10, 16);
    const out = rng.range(3, 7);
    const u0 = rng.range(1, Math.max(1.5, lane.uMax - len));
    const pts = [];
    for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        pts.push(lane.at(u0 + t * len, s * (1.2 + out * Math.sin(Math.PI * t)), 0));
    }
    return { tool: 'ground', planeY: 0, points: pts };
}

function spring(rng, lane, ctx) {
    let c;
    let y0 = 0;
    if (rng.chance(0.5)) {
        const h = ctx.baseHalf - 1.1;
        c = ctx.layout === 'radial' ? lane.at(-ctx.baseHalf, rng.sign() * 4.7, 0) : lane.at(-1.1, rng.sign() * h, 0);
    } else {
        c = lane.at(rng.range(2, lane.uMax), rng.sign() * rng.range(6, 15), 0);
        y0 = rng.range(-5, 1);
    }
    const r = rng.range(0.9, 1.35);
    const turns = rng.int(5, 8);
    const pitch = rng.range(0.7, 0.95);
    const total = turns * Math.PI * 2;
    const step = 0.42 / r;
    const pts = [];
    for (let a = 0; a <= total; a += step) {
        pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, y0 + (a / (Math.PI * 2)) * pitch, c.z + Math.sin(a) * r));
    }
    return { tool: 'ribbon', planeNormal: UP.clone(), width: 0.5, thickness: 0.32, smooth: false, points: pts };
}

function airScribble(rng, lane) {
    const size = rng.range(4, 7.5);
    const u = rng.range(3, lane.uMax + 4);
    const x = rng.sign() * rng.range(5, 18);
    const y = rng.range(2, 11);
    const kind = rng.weighted([
        [5, 'letter'],
        [2, 'zig'],
        [1, 'heart'],
        [1, 'star'],
        [2, 'squiggle'],
    ]);
    let shape;
    if (kind === 'letter') {
        const L = LETTERS[rng.pick(Object.keys(LETTERS))];
        shape = L.map(([a, b]) => [a * size * 0.8, b * size]);
    } else if (kind === 'zig') {
        const n = rng.int(4, 7);
        shape = [];
        for (let i = 0; i < n; i++) shape.push([(i % 2) * size * 0.6, (i / (n - 1)) * size * 1.6]);
    } else if (kind === 'heart') {
        shape = heart2D(size);
    } else if (kind === 'star') {
        shape = star2D(size * 1.2);
    } else {
        const len = size * 2;
        const ph = rng.range(0, 6);
        shape = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            shape.push([t * len, size * 0.35 * Math.sin(t * 9 + ph) + size * 0.2 * Math.sin(t * 4.3)]);
        }
    }
    const pts = shape.map(([a, b]) => lane.at(u, x + a - size * 0.4, y + b));
    return { tool: 'ribbon', planeNormal: lane.along.clone(), points: densify(pts) };
}

function hoop(rng, lane) {
    const r = rng.range(3.5, 6);
    const u = rng.range(3, lane.uMax);
    const pts = circle2D(r, 48, -Math.PI / 2).map(([a, b]) => lane.at(u, a, r - 0.25 + b));
    return { tool: 'ribbon', planeNormal: lane.along.clone(), points: densify(pts) };
}

function stairs(rng, lane) {
    const s = rng.sign();
    const x = s * rng.range(6, 15);
    const u = rng.range(2, lane.uMax);
    const y = rng.range(-3, 1);
    const n = rng.int(4, 7);
    const pts = [];
    if (rng.chance(0.5)) {
        // stepped stairs climbing toward the enemy
        const sw = rng.range(1.6, 2.4);
        const sh = rng.range(1.0, 1.5);
        for (let i = 0; i < n; i++) {
            pts.push(lane.at(u + i * sw, x, y + i * sh), lane.at(u + (i + 1) * sw, x, y + i * sh));
        }
        return { tool: 'ribbon', planeNormal: lane.across.clone(), points: densify(pts) };
    }
    // zig-zag tower
    const w = rng.range(2.5, 4);
    const h = rng.range(1.6, 2.4);
    for (let i = 0; i <= n; i++) pts.push(lane.at(u, x + (i % 2) * w * s, y + i * h));
    return { tool: 'ribbon', planeNormal: lane.along.clone(), points: densify(pts) };
}

const RECIPES = [
    [3, sideWalk],
    [2, hill],
    [4, slab],
    [2, coverWall],
    [1.5, baseWall],
    [1.5, spring],
    [3, airScribble],
    [1.2, hoop],
    [2, stairs],
    [2, path],
];
const USEFUL = [sideWalk, slab, hill, coverWall, path];
// per-team caps so a lobby doesn't stack ten hills on the bridge
export const TEAM_CAP = new Map([
    [sideWalk, 2],
    [hill, 1],
    [hoop, 1],
    [baseWall, 2],
    [spring, 3],
    [coverWall, 3],
    [path, 2],
]);

function validShape(desc, arena) {
    for (const p of desc.points) {
        if (!arena.bounds.containsPoint(p)) return false;
        if (inNoDrawZone(arena, p)) return false;
    }
    return desc.points.length >= 2;
}

export function laneFor(team, mode) {
    if (mode.layout === 'duel') {
        const sign = team === 0 ? 1 : -1;
        const L = mode.length;
        const S = mode.baseSize;
        return {
            lane: new Lane(
                new THREE.Vector3(0, 0, sign * (L / 2 - S / 2)),
                new THREE.Vector3(0, 0, -sign),
                new THREE.Vector3(sign, 0, 0),
                L / 2 - S / 2 + 5,
            ),
            ctx: { layout: 'duel', baseHalf: S / 2 },
        };
    }
    const ang = (team / mode.teamCount) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
    return {
        lane: new Lane(
            dir.clone().multiplyScalar(mode.radius - 5.2),
            dir.clone().negate(),
            new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang)),
            mode.radius - 5.2 - 7,
        ),
        ctx: { layout: 'radial', baseHalf: 5.2 },
    };
}

export function planShapes(
    rng,
    team,
    mode,
    arena,
    { ink = STROKE.ink, time = 52, speed = 18, maxShapes = 6, teamCounts = new Map() } = {},
) {
    const { lane, ctx } = laneFor(team, mode);
    const plan = [];
    let inkLeft = ink;
    let timeLeft = time;
    for (let n = 0; n < maxShapes && timeLeft > 3; n++) {
        let desc = null;
        let used = null;
        for (let attempt = 0; attempt < 10 && !desc; attempt++) {
            const recipe = n === 0 ? rng.pick(USEFUL) : rng.weighted(RECIPES);
            if ((teamCounts.get(recipe) ?? 0) >= (TEAM_CAP.get(recipe) ?? Infinity)) continue;
            const d = recipe(rng, lane, ctx);
            if (d && validShape(d, arena)) {
                desc = d;
                used = recipe;
            }
        }
        if (!desc) continue;
        const len = polylineLength(desc.points);
        if (len > inkLeft) break;
        inkLeft -= len;
        timeLeft -= len / speed + 2.6;
        teamCounts.set(used, (teamCounts.get(used) ?? 0) + 1);
        plan.push(desc);
    }
    return plan;
}

export class BotArtist {
    constructor({ who, strokes, arena, mode, hud, rng, startDelay = 0, maxShapes = 6, teamCounts }) {
        this.who = who;
        this.strokes = strokes;
        this.rng = rng;
        this.speed = rng.range(14, 20);
        this.plan = planShapes(rng, who.team, mode, arena, { speed: this.speed, maxShapes, teamCounts });
        this.cursor = hud.createCursor(who.name, who.color);
        const { lane } = laneFor(who.team, mode);
        this.pos = lane.at(rng.range(2, 10), rng.range(-8, 8), rng.range(4, 10));
        this.state = 'wait';
        this.timer = startDelay + rng.range(0.2, 2.2);
        this.current = null;
        this.t = rng.range(0, 10);
        this.wobble = new THREE.Vector3();
    }

    get busy() {
        return this.state !== 'done';
    }

    next() {
        const desc = this.plan.shift();
        if (!desc) {
            this.state = 'done';
            return;
        }
        this.current = { desc, from: this.pos.clone(), moveT: 0 };
        this.current.moveDur = THREE.MathUtils.clamp(this.pos.distanceTo(desc.points[0]) / 30, 0.35, 1.3);
        this.state = 'move';
    }

    createStroke(desc) {
        return this.strokes.create({
            team: this.who.team,
            owner: this.who,
            tool: desc.tool,
            planeNormal: desc.planeNormal,
            planeY: desc.planeY ?? 0,
            width: desc.width,
            thickness: desc.thickness,
            smooth: desc.smooth,
        });
    }

    beginStroke() {
        const { desc } = this.current;
        const stroke = this.createStroke(desc);
        stroke.addPoint(desc.points[0]);
        const cum = [0];
        for (let i = 1; i < desc.points.length; i++) {
            cum.push(cum[i - 1] + desc.points[i].distanceTo(desc.points[i - 1]));
        }
        // dirty: points were added since the last live rebuild
        Object.assign(this.current, { stroke, idx: 0, dist: 0, cum, rebuild: 0, dirty: false });
        this.state = 'draw';
    }

    advance(dt) {
        const c = this.current;
        const pts = c.desc.points;
        c.dist += this.speed * dt;
        while (c.idx + 1 < pts.length && c.cum[c.idx + 1] <= c.dist) {
            c.idx++;
            c.stroke.addPoint(pts[c.idx]);
            c.dirty = true;
        }
        if (c.idx + 1 < pts.length) {
            const seg = c.cum[c.idx + 1] - c.cum[c.idx];
            const f = seg > 0 ? (c.dist - c.cum[c.idx]) / seg : 0;
            this.pos.copy(pts[c.idx]).lerp(pts[c.idx + 1], f);
        } else {
            this.pos.copy(pts[pts.length - 1]);
        }
        c.rebuild -= dt;
        if (c.idx >= pts.length - 1) {
            c.stroke.rebuild(true);
            this.current = null;
            this.state = 'wait';
            this.timer = this.rng.range(0.6, 2.2);
        } else if (c.dirty && c.rebuild <= 0) {
            c.stroke.rebuild(false);
            c.dirty = false;
            c.rebuild = REBUILD_EVERY;
        }
    }

    update(dt, camera, width, height) {
        this.t += dt;
        if (this.state === 'wait') {
            this.timer -= dt;
            if (this.timer <= 0) this.next();
        } else if (this.state === 'move') {
            const c = this.current;
            c.moveT = Math.min(1, c.moveT + dt / c.moveDur);
            const e = c.moveT < 0.5 ? 4 * c.moveT ** 3 : 1 - (-2 * c.moveT + 2) ** 3 / 2;
            this.pos.copy(c.from).lerp(c.desc.points[0], e);
            if (c.moveT >= 1) this.beginStroke();
        } else if (this.state === 'draw') {
            this.advance(dt);
        }

        const idle = this.state === 'wait' || this.state === 'done';
        this.wobble.set(Math.sin(this.t * 1.3) * 0.5, Math.sin(this.t * 1.7 + 1) * 0.35, Math.cos(this.t * 1.1) * 0.5);
        _ndc.copy(this.pos);
        if (idle) _ndc.add(this.wobble);
        _ndc.project(camera);
        const visible = _ndc.z < 1 && Math.abs(_ndc.x) < 1.2 && Math.abs(_ndc.y) < 1.2;
        this.cursor.set(((_ndc.x + 1) / 2) * width, ((1 - _ndc.y) / 2) * height, visible);
    }

    // Complete the current and all remaining planned shapes instantly.
    finishAll() {
        if (this.current?.stroke) {
            const { stroke, desc, idx } = this.current;
            for (let i = idx + 1; i < desc.points.length; i++) stroke.addPoint(desc.points[i]);
            stroke.rebuild(true);
        } else if (this.current) {
            this.plan.unshift(this.current.desc);
        }
        this.current = null;
        for (const desc of this.plan) {
            const stroke = this.createStroke(desc);
            for (const p of desc.points) stroke.addPoint(p);
            stroke.rebuild(true);
        }
        this.plan = [];
        this.state = 'done';
    }

    dispose() {
        this.cursor.remove();
    }
}
