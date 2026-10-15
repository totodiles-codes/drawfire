import * as THREE from 'three';
import { STROKE } from './config.js';

// Geometry for drawn strokes. Every stroke is either a swept band (rounded-rect profile pushed along
// the path) or an extruded slab (closed loop drawn on the ground). Material group 0 is the broad
// "face" of the shape, group 1 the thin "edge" trim - the fight phase whitens group 0 only.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function polylineLength(points, closed = false) {
    let len = 0;
    for (let i = 1; i < points.length; i++) len += points[i].distanceTo(points[i - 1]);
    if (closed && points.length > 2) len += points[0].distanceTo(points[points.length - 1]);
    return len;
}

// Unnormalised Newell vector of a (roughly planar) loop: it points along the loop's normal and its
// length is twice the enclosed area.
function newellVector(points) {
    const n = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n;
}

// Area enclosed by a (roughly planar) loop, via Newell's method.
export function loopArea(points) {
    const n = newellVector(points);
    return Math.hypot(n.x, n.y, n.z) / 2;
}

// Closest pair between the first and last quarter of a stroke, so a loop that overshoots its
// start still closes (the overhang is trimmed away). Returns { i, j, gap } or null.
export function loopClosure(points) {
    const n = points.length;
    if (n < 6) return null;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    const len = cum[n - 1];
    let head = 0;
    while (head + 1 < n && cum[head + 1] <= len * 0.25) head++;
    let tail = n - 1;
    while (tail - 1 > head && cum[tail - 1] >= len * 0.75) tail--;
    let best = { i: 0, j: n - 1, d2: points[0].distanceToSquared(points[n - 1]) };
    for (let i = 0; i <= head; i++) {
        for (let j = tail; j < n; j++) {
            const d2 = points[i].distanceToSquared(points[j]);
            if (d2 < best.d2) best = { i, j, d2 };
        }
    }
    return { i: best.i, j: best.j, gap: Math.sqrt(best.d2) };
}

// maxGap: extra closing tolerance (the draw phase passes ~40 px converted to metres).
export function isClosedStroke(points, maxGap = 0) {
    if (points.length < 6) return false;
    const len = polylineLength(points);
    if (len <= 9) return false;
    const c = loopClosure(points);
    if (!c || c.gap >= Math.max(2.4, len * 0.07, Math.min(maxGap, len * 0.25))) return false;
    const loop = points.slice(c.i, c.j + 1);
    const loopLen = polylineLength(loop, true);
    // one Newell pass gives both the area and the normal
    let n = newellVector(loop);
    let area = Math.hypot(n.x, n.y, n.z) / 2;
    if (n.lengthSq() > 0) n.normalize();
    else n.set(0, 1, 0);
    // a flat figure-8's lobes cancel out in the signed area; judge it by the area it covers
    const flat = loop.every((p) => Math.abs(p.y - loop[0].y) < 0.05);
    if (flat && selfIntersectsXZ(loop)) {
        area = loopArea(convexHullXZ(loop));
        n = new THREE.Vector3(0, 1, 0);
    }
    // an out-and-back line also ends near its start, but encloses nothing: require a mean width
    // (2 * area / perimeter) of at least a metre - stars and C shapes pass, slivers don't
    if (!(area > 3 && (2 * area) / loopLen > 1)) return false;
    // and a coil (bot springs) passes near itself without being a flat loop
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of loop) {
        const d = p.dot(n);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
    }
    return hi - lo <= Math.max(0.6, 0.2 * Math.sqrt(area));
}

// The part of a closed stroke that forms the loop (overshoot trimmed).
export function closedLoop(points) {
    const c = loopClosure(points);
    return c ? points.slice(c.i, c.j + 1) : points;
}

function cross2(ax, az, bx, bz, cx, cz) {
    return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

// p is collinear with a-b: is it within the segment?
function onSegmentXZ(a, b, p) {
    return (
        p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.z >= Math.min(a.z, b.z) && p.z <= Math.max(a.z, b.z)
    );
}

// Does a closed polygon (in x/z) cross or touch itself? Non-adjacent edges only; a crossing exactly
// through a vertex counts too (evenly resampled loops often hit one).
export function selfIntersectsXZ(path) {
    const n = path.length;
    for (let i = 0; i < n; i++) {
        const a = path[i];
        const b = path[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const c = path[j];
            const d = path[(j + 1) % n];
            const d1 = cross2(a.x, a.z, b.x, b.z, c.x, c.z);
            const d2 = cross2(a.x, a.z, b.x, b.z, d.x, d.z);
            const d3 = cross2(c.x, c.z, d.x, d.z, a.x, a.z);
            const d4 = cross2(c.x, c.z, d.x, d.z, b.x, b.z);
            // proper crossing, or a vertex lying on the other edge (collinear but apart doesn't count)
            if (Math.sign(d1) * Math.sign(d2) < 0 && Math.sign(d3) * Math.sign(d4) < 0) return true;
            if (
                (d1 === 0 && onSegmentXZ(a, b, c)) ||
                (d2 === 0 && onSegmentXZ(a, b, d)) ||
                (d3 === 0 && onSegmentXZ(c, d, a)) ||
                (d4 === 0 && onSegmentXZ(c, d, b))
            ) {
                return true;
            }
        }
    }
    return false;
}

// Monotone-chain convex hull in x/z, at the height of the first point.
export function convexHullXZ(points) {
    const pts = [...points].sort((p, q) => p.x - q.x || p.z - q.z);
    const half = (list) => {
        const out = [];
        for (const p of list) {
            while (out.length >= 2) {
                const a = out[out.length - 2];
                const b = out[out.length - 1];
                if (cross2(a.x, a.z, b.x, b.z, p.x, p.z) > 0) break;
                out.pop();
            }
            out.push(p);
        }
        out.pop();
        return out;
    };
    const y = points[0].y;
    return [...half(pts), ...half([...pts].reverse())].map((p) => new THREE.Vector3(p.x, y, p.z));
}

// Light [1/4, 1/2, 1/4] smoothing to remove mouse jitter; endpoints stay put on open strokes.
export function smoothPoints(points, closed = false, passes = 1) {
    let pts = points.map((p) => p.clone());
    const n = pts.length;
    if (n < 3) return pts;
    for (let pass = 0; pass < passes; pass++) {
        const out = pts.map((p) => p.clone());
        for (let i = 0; i < n; i++) {
            if (!closed && (i === 0 || i === n - 1)) continue;
            const prev = pts[(i - 1 + n) % n];
            const next = pts[(i + 1) % n];
            out[i].copy(pts[i]).multiplyScalar(0.5).addScaledVector(prev, 0.25).addScaledVector(next, 0.25);
        }
        pts = out;
    }
    return pts;
}

export function resampleStroke(points, spacing = STROKE.spacing, closed = false) {
    const pts = [];
    for (const p of points) {
        if (!pts.length || pts[pts.length - 1].distanceToSquared(p) > 1e-4) pts.push(p.clone());
    }
    if (closed && pts.length > 3 && pts[0].distanceTo(pts[pts.length - 1]) < spacing * 2) pts.pop();
    if (pts.length < 2) return pts;
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    const len = polylineLength(pts, closed);
    const count = Math.max(2, Math.ceil(len / spacing));
    curve.arcLengthDivisions = Math.min(4000, count * 4);
    const out = curve.getSpacedPoints(count);
    if (closed) out.pop();
    return out;
}

// Rounded rectangle profile, counter-clockwise in (u, v). Each vertex carries its normal and the
// material group of the segment that starts at it.
// swapGroups: make the +/-u faces the broad "face" (group 0) instead of +/-v - used by flat paths,
// whose top/bottom are the u faces.
function buildProfile(width, thickness, cornerSegments, swapGroups = false) {
    const a = width / 2;
    const b = thickness / 2;
    const r = Math.min(b * 0.9, a * 0.9, 0.22);
    const centers = [
        [a - r, b - r],
        [-(a - r), b - r],
        [-(a - r), -(b - r)],
        [a - r, -(b - r)],
    ];
    // Straight segment leaving corner k: top face, left edge, bottom face, right edge.
    const straightGroup = swapGroups ? [1, 0, 1, 0] : [0, 1, 0, 1];
    const profile = [];
    for (let k = 0; k < 4; k++) {
        const start = (k * Math.PI) / 2;
        for (let j = 0; j <= cornerSegments; j++) {
            const ang = start + (j / Math.max(1, cornerSegments)) * (Math.PI / 2);
            const nu = Math.cos(ang);
            const nv = Math.sin(ang);
            const last = j === cornerSegments;
            profile.push({
                u: centers[k][0] + nu * r,
                v: centers[k][1] + nv * r,
                nu,
                nv,
                group: last ? straightGroup[k] : 1,
            });
            if (cornerSegments === 0) break;
        }
    }
    return profile;
}

/**
 * Sweep a rounded-rect profile along a path.
 * widthDir: preferred direction of the band's wide axis (projected per point to stay orthogonal).
 * offset: shifts the band along widthDir (walls sit on top of the drawing plane).
 */
export function buildBandGeometry(path, opts) {
    const {
        widthDir,
        width = STROKE.ribbonWidth,
        thickness = STROKE.thickness,
        closed = false,
        offset = 0,
        cornerSegments = 2,
        caps = true,
        swapGroups = false,
    } = opts;
    const n = path.length;
    const geo = new THREE.BufferGeometry();
    if (n < 2) return geo;

    const profile = buildProfile(width, thickness, cornerSegments, swapGroups);
    const P = profile.length;
    const positions = [];
    const normals = [];
    const tangents = [];
    const frames = [];

    for (let i = 0; i < n; i++) {
        const prev = closed ? path[(i - 1 + n) % n] : path[Math.max(i - 1, 0)];
        const next = closed ? path[(i + 1) % n] : path[Math.min(i + 1, n - 1)];
        _t.subVectors(next, prev);
        if (_t.lengthSq() < 1e-10) _t.set(1, 0, 0);
        _t.normalize();
        _u.copy(widthDir).addScaledVector(_t, -_t.dot(widthDir));
        if (_u.lengthSq() < 1e-6) {
            _u.set(0, 1, 0).addScaledVector(_t, -_t.y);
            if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0).addScaledVector(_t, -_t.x);
        }
        _u.normalize();
        _v.crossVectors(_t, _u);

        let miter = 1;
        const interior = closed || (i > 0 && i < n - 1);
        if (interior) {
            _a.subVectors(path[i], prev);
            _b.subVectors(next, path[i]);
            if (_a.lengthSq() > 1e-10 && _b.lengthSq() > 1e-10) {
                const cosHalf = Math.sqrt(Math.max(0, (1 + _a.normalize().dot(_b.normalize())) / 2));
                miter = 1 / Math.max(cosHalf, 0.5);
            }
        }

        for (const pr of profile) {
            _p.copy(path[i]).addScaledVector(_u, pr.u + offset).addScaledVector(_v, pr.v * miter);
            positions.push(_p.x, _p.y, _p.z);
            _a.copy(_u).multiplyScalar(pr.nu).addScaledVector(_v, pr.nv).normalize();
            normals.push(_a.x, _a.y, _a.z);
        }
        tangents.push(_t.clone());
        frames.push({ u: _u.clone(), v: _v.clone(), miter });
    }

    const faceIdx = [];
    const edgeIdx = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        const i2 = (i + 1) % n;
        for (let k = 0; k < P; k++) {
            const k2 = (k + 1) % P;
            const a = i * P + k;
            const b = i * P + k2;
            const c = i2 * P + k;
            const d = i2 * P + k2;
            const arr = profile[k].group === 0 ? faceIdx : edgeIdx;
            arr.push(a, b, c, b, d, c);
        }
    }

    if (!closed && caps) {
        for (const [ring, sign] of [
            [0, -1],
            [n - 1, 1],
        ]) {
            const base = positions.length / 3;
            const tn = tangents[ring];
            const { u } = frames[ring];
            _p.copy(path[ring]).addScaledVector(u, offset);
            positions.push(_p.x, _p.y, _p.z);
            normals.push(tn.x * sign, tn.y * sign, tn.z * sign);
            for (let k = 0; k < P; k++) {
                const src = (ring * P + k) * 3;
                positions.push(positions[src], positions[src + 1], positions[src + 2]);
                normals.push(tn.x * sign, tn.y * sign, tn.z * sign);
            }
            for (let k = 0; k < P; k++) {
                const k2 = (k + 1) % P;
                if (sign > 0) edgeIdx.push(base, base + 1 + k, base + 1 + k2);
                else edgeIdx.push(base, base + 1 + k2, base + 1 + k);
            }
        }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(faceIdx.concat(edgeIdx));
    geo.addGroup(0, faceIdx.length, 0);
    geo.addGroup(faceIdx.length, edgeIdx.length, 1);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
}

// Closed loop drawn on a horizontal plane -> flat platform whose top face sits at `top`.
export function buildSlabGeometry(path, top, thickness = STROKE.slabThickness) {
    const bevel = 0.12;
    const depth = Math.max(0.05, thickness - bevel * 2);
    const shape = new THREE.Shape(path.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    // extruded y spans [-bevel, depth + bevel]; the bevel only widens the sides
    geo.translate(0, top - depth - bevel, 0);
    geo.deleteAttribute('uv');
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
}

/**
 * Geometry for a stroke description:
 *   { tool: 'ribbon' | 'ground' | 'wall', points, planeNormal, planeY, closed, width?, thickness? }
 * Ribbons extend along the drawing plane's normal (horizontal lines become floors). Ground strokes are
 * flat walkable paths lying on the plane, or platforms when the loop is closed. Wall strokes stand on
 * the plane (closed loops become rings).
 */
export function strokeGeometry(stroke, final = true) {
    const closed = final && stroke.closed;
    const pts = closed ? closedLoop(stroke.points) : stroke.points;
    if (stroke.tool === 'ground' && closed) {
        let path = resampleStroke(smoothPoints(pts, true, 2), 0.6, true);
        // a figure-8 can't be triangulated sensibly; cover the drawn area instead
        if (selfIntersectsXZ(path)) path = convexHullXZ(path);
        if (path.length >= 3) {
            return buildSlabGeometry(path, stroke.planeY + STROKE.groundLift, stroke.thickness ?? STROKE.slabThickness);
        }
    }
    const smoothed = stroke.smooth === false ? pts : smoothPoints(pts, closed, 1);
    const path = resampleStroke(smoothed, STROKE.spacing, closed);
    if (stroke.tool === 'ground') {
        const t = stroke.thickness ?? STROKE.pathThickness;
        return buildBandGeometry(path, {
            widthDir: UP,
            width: t,
            thickness: stroke.width ?? STROKE.pathWidth,
            offset: STROKE.groundLift - t / 2,
            closed,
            swapGroups: true,
        });
    }
    if (stroke.tool === 'wall') {
        const height = stroke.width ?? STROKE.wallHeight;
        return buildBandGeometry(path, {
            widthDir: UP,
            width: height,
            thickness: stroke.thickness ?? STROKE.thickness,
            offset: height / 2 - 0.2,
            closed,
        });
    }
    return buildBandGeometry(path, {
        widthDir: stroke.planeNormal,
        width: stroke.width ?? STROKE.ribbonWidth,
        thickness: stroke.thickness ?? STROKE.thickness,
        closed,
    });
}
