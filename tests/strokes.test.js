import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    buildBandGeometry,
    closedLoop,
    convexHullXZ,
    selfIntersectsXZ,
    buildSlabGeometry,
    isClosedStroke,
    loopArea,
    polylineLength,
    resampleStroke,
    strokeGeometry,
} from '../src/strokes.js';
import { STROKE } from '../src/config.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

function circle(r, n = 40, y = 0) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(v(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return pts;
}

// Every triangle's winding should agree with its vertex normals (i.e. faces point outward).
function windingAgreesWithNormals(geo) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const idx = geo.index.array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const face = new THREE.Vector3();
    let bad = 0;
    for (let i = 0; i < idx.length; i += 3) {
        a.fromBufferAttribute(pos, idx[i]);
        b.fromBufferAttribute(pos, idx[i + 1]);
        c.fromBufferAttribute(pos, idx[i + 2]);
        face.subVectors(b, a).cross(c.clone().sub(a));
        if (face.lengthSq() < 1e-12) continue;
        n.fromBufferAttribute(nor, idx[i]).add(new THREE.Vector3().fromBufferAttribute(nor, idx[i + 1]));
        n.add(new THREE.Vector3().fromBufferAttribute(nor, idx[i + 2]));
        if (face.dot(n) <= 0) bad++;
    }
    return bad;
}

describe('stroke helpers', () => {
    it('detects closed loops but not straight lines', () => {
        expect(isClosedStroke(circle(3))).toBe(true);
        const line = [v(0, 0, 0), v(5, 0, 0), v(10, 0, 0), v(15, 0, 0), v(20, 0, 0), v(25, 0, 0)];
        expect(isClosedStroke(line)).toBe(false);
    });

    it('does not treat an out-and-back line as a closed loop', () => {
        const pts = [];
        for (let x = 0; x <= 8; x += 0.5) pts.push(v(x, 0, 0));
        for (let x = 8; x >= 0; x -= 0.5) pts.push(v(x, 0, 0.3));
        expect(isClosedStroke(pts)).toBe(false);
    });

    it('resamples to roughly even spacing', () => {
        const pts = resampleStroke([v(0, 0, 0), v(10, 0, 0), v(10, 5, 0)], 0.5, false);
        for (let i = 1; i < pts.length; i++) {
            expect(pts[i].distanceTo(pts[i - 1])).toBeGreaterThan(0.3);
            expect(pts[i].distanceTo(pts[i - 1])).toBeLessThan(0.7);
        }
        expect(polylineLength(pts)).toBeGreaterThan(14);
    });
});

describe('band geometry', () => {
    it('sweeps a straight ribbon with the requested width and thickness', () => {
        const path = resampleStroke([v(0, 0, 0), v(10, 0, 0)], 0.5);
        const geo = buildBandGeometry(path, { widthDir: v(0, 0, 1), width: 3, thickness: 0.5 });
        const bb = geo.boundingBox;
        expect(bb.min.z).toBeCloseTo(-1.5, 2);
        expect(bb.max.z).toBeCloseTo(1.5, 2);
        expect(bb.max.y - bb.min.y).toBeCloseTo(0.5, 2);
        expect(bb.max.x).toBeCloseTo(10, 2);
        expect(geo.groups).toHaveLength(2);
        expect(geo.groups[0].count).toBeGreaterThan(0);
        expect(geo.groups[1].count).toBeGreaterThan(0);
    });

    it('faces point outward for open and closed bands', () => {
        const open = buildBandGeometry(resampleStroke([v(0, 0, 0), v(5, 3, 0), v(10, 0, 0)], 0.4), {
            widthDir: v(0, 0, 1),
        });
        const closed = buildBandGeometry(resampleStroke(circle(4), 0.4, true), {
            widthDir: v(0, 1, 0),
            closed: true,
        });
        expect(windingAgreesWithNormals(open)).toBe(0);
        expect(windingAgreesWithNormals(closed)).toBe(0);
    });
});

// Normal of each triangle in material group `g`.
function groupNormals(geo, g) {
    const grp = geo.groups.find((x) => x.materialIndex === g);
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const out = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
        a.fromBufferAttribute(pos, idx[i]);
        b.fromBufferAttribute(pos, idx[i + 1]);
        c.fromBufferAttribute(pos, idx[i + 2]);
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        if (n.lengthSq() > 1e-12) out.push(n.normalize());
    }
    return out;
}

describe('stroke shapes', () => {
    it('wall strokes stand on the drawing plane', () => {
        const geo = strokeGeometry({ tool: 'wall', points: [v(0, 2, 0), v(4, 2, 0), v(8, 2, 1)], planeY: 2 });
        geo.computeBoundingBox();
        expect(geo.boundingBox.min.y).toBeCloseTo(2 - 0.2, 1);
        expect(geo.boundingBox.max.y).toBeCloseTo(2 + STROKE.wallHeight - 0.2, 1);
    });

    it('ground strokes are flat paths whose top lies just above the plane', () => {
        const pts = [];
        for (let x = 0; x <= 12; x += 0.5) pts.push(v(x, 2, Math.sin(x * 0.3) * 2));
        const geo = strokeGeometry({ tool: 'ground', points: pts, planeY: 2 });
        geo.computeBoundingBox();
        expect(geo.boundingBox.max.y).toBeCloseTo(2 + STROKE.groundLift, 2);
        expect(geo.boundingBox.min.y).toBeCloseTo(2 + STROKE.groundLift - STROKE.pathThickness, 2);
        // the broad face (white in the fight look) is the walkable top and bottom
        const face = groupNormals(geo, 0);
        expect(face.every((n) => Math.abs(n.y) > 0.9)).toBe(true);
        expect(face.some((n) => n.y > 0.9)).toBe(true);
        expect(windingAgreesWithNormals(geo)).toBe(0);
    });

    it('ribbons keep vertical-facing broad faces (no group swap)', () => {
        const path = resampleStroke([v(0, 0, 0), v(10, 0, 0)], 0.5);
        const geo = buildBandGeometry(path, { widthDir: v(0, 0, 1), width: 3, thickness: 0.4 });
        expect(groupNormals(geo, 0).every((n) => Math.abs(n.y) > 0.9)).toBe(true);
        const wall = buildBandGeometry(path, { widthDir: v(0, 1, 0), width: 3, thickness: 0.4 });
        expect(groupNormals(wall, 0).every((n) => Math.abs(n.y) < 0.1)).toBe(true);
    });

    it('slabs put their top face exactly at the requested height', () => {
        const geo = buildSlabGeometry(circle(3, 30, 5), 5.06, 0.6);
        expect(geo.boundingBox.max.y).toBeCloseTo(5.06, 3);
        expect(geo.boundingBox.min.y).toBeCloseTo(4.46, 3);
        expect(geo.boundingBox.max.x).toBeGreaterThan(2.9);
        const closedGround = strokeGeometry({ tool: 'ground', points: circle(4, 40, 1), planeY: 1, closed: true });
        closedGround.computeBoundingBox();
        expect(closedGround.boundingBox.max.y).toBeCloseTo(1 + STROKE.groundLift, 2);
    });

    it('closed wall loops become rings, not platforms', () => {
        const geo = strokeGeometry({ tool: 'wall', points: circle(5, 40, 0), planeY: 0, closed: true });
        const pos = geo.attributes.position;
        let minR = Infinity;
        for (let i = 0; i < pos.count; i++) minR = Math.min(minR, Math.hypot(pos.getX(i), pos.getZ(i)));
        expect(minR).toBeGreaterThan(3);
    });

    it('ribbon strokes extend along the plane normal', () => {
        const geo = strokeGeometry({
            tool: 'ribbon',
            points: [v(0, 0, 0), v(3, 1, 0), v(6, 0, 0)],
            planeNormal: v(0, 0, 1),
        });
        geo.computeBoundingBox();
        expect(geo.boundingBox.max.z).toBeCloseTo(STROKE.ribbonWidth / 2, 1);
    });
});

function arc(r, turns, n = 60, y = 0) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * turns * Math.PI * 2;
        pts.push(v(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return pts;
}

describe('closing loops', () => {
    it('a loop drawn past its start still closes, and the overhang is trimmed', () => {
        const pts = arc(4, 1.15, 69);
        expect(isClosedStroke(pts)).toBe(true);
        const loop = closedLoop(pts);
        expect(loop.length).toBeLessThan(pts.length);
        expect(loop[0].distanceTo(loop[loop.length - 1])).toBeLessThan(0.5);
    });

    it('a loop that stops short only closes with the screen-distance allowance', () => {
        const pts = arc(4, 0.85, 51);
        expect(isClosedStroke(pts)).toBe(false);
        expect(isClosedStroke(pts, 4)).toBe(true);
    });

    it('U shapes, out-and-back lines and coils stay open', () => {
        const u = [];
        for (let z = 8; z >= 0; z -= 0.5) u.push(v(0, 0, z));
        for (let x = 0.5; x <= 6; x += 0.5) u.push(v(x, 0, 0));
        for (let z = 0.5; z <= 8; z += 0.5) u.push(v(6, 0, z));
        expect(isClosedStroke(u, 7)).toBe(false);

        const coil = [];
        for (let a = 0; a <= 6 * Math.PI * 2; a += 0.35) {
            coil.push(v(Math.cos(a) * 1.2, (a / (Math.PI * 2)) * 0.8, Math.sin(a) * 1.2));
        }
        expect(isClosedStroke(coil)).toBe(false);
        const coil5 = [];
        for (let a = 0; a <= 5 * Math.PI * 2; a += 0.35) {
            coil5.push(v(Math.cos(a) * 1.2, (a / (Math.PI * 2)) * 0.7, Math.sin(a) * 1.2));
        }
        expect(isClosedStroke(coil5)).toBe(false);
    });

    it('a figure-8 platform falls back to its convex hull', () => {
        const pts = [];
        for (let i = 0; i <= 80; i++) {
            const t = (i / 80) * Math.PI * 2;
            pts.push(v(Math.sin(t) * 6, 0, Math.sin(t) * Math.cos(t) * 4));
        }
        const path = resampleStroke(pts, 0.6, true);
        expect(selfIntersectsXZ(path)).toBe(true);
        // the lobes' signed areas cancel; the hull area is what makes it count as closed
        expect(isClosedStroke(pts)).toBe(true);
        const geo = strokeGeometry({ tool: 'ground', points: pts, planeY: 0, closed: true });
        geo.computeBoundingBox();
        expect(geo.boundingBox.max.y).toBeCloseTo(STROKE.groundLift, 2);
        expect(geo.boundingBox.max.x).toBeGreaterThan(5.5);
    });

    it('measures loop area and closes loops on tilted planes', () => {
        expect(loopArea([v(0, 0, 0), v(4, 0, 0), v(4, 0, 4), v(0, 0, 4)])).toBeCloseTo(16);
        // a 4 x 5 rectangle on a 3-4-5 slope
        expect(loopArea([v(0, 0, 0), v(4, 0, 0), v(4, 3, 4), v(0, 3, 4)])).toBeCloseTo(20);
        const tilt = new THREE.Matrix4().makeRotationAxis(v(1, 0, 1).normalize(), 0.7);
        expect(isClosedStroke(circle(3).map((p) => p.applyMatrix4(tilt)))).toBe(true);
    });

    it('collinear edges are not self-intersections', () => {
        const sq = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0), v(3, 0, 3), v(0, 0, 3)];
        expect(selfIntersectsXZ(sq)).toBe(false);
    });

    it('concave outlines (star, C) close like any loop', () => {
        const star = [];
        for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const r = i % 2 ? 2.5 : 6;
            star.push(v(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        expect(isClosedStroke(resampleStroke(star, 0.5))).toBe(true);
        const c = [
            v(0, 0, 0),
            v(8, 0, 0),
            v(8, 0, 2),
            v(2, 0, 2),
            v(2, 0, 6),
            v(8, 0, 6),
            v(8, 0, 8),
            v(0, 0, 8),
            v(0, 0, 0),
        ];
        expect(isClosedStroke(resampleStroke(c, 0.5))).toBe(true);
    });

    it('convexHullXZ keeps only the outer corners', () => {
        const hull = convexHullXZ([v(0, 1, 0), v(4, 1, 0), v(4, 1, 4), v(0, 1, 4), v(2, 1, 2), v(1, 1, 3)]);
        expect(hull).toHaveLength(4);
        expect(hull.every((p) => p.y === 1)).toBe(true);
    });
});
