import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PHYS } from './config.js';

// Static collision world (arena + every drawn stroke merged into one BVH) and capsule movement.

const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _ray = new THREE.Ray();
const _center = new THREE.Vector3();

export class World {
    constructor() {
        this.bvh = null;
        this.geometry = null;
    }

    build(meshes) {
        const parts = [];
        for (const m of meshes) {
            if (!m.geometry?.attributes?.position) continue;
            m.updateWorldMatrix(true, false);
            let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
            for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
            g.clearGroups();
            g.applyMatrix4(m.matrixWorld);
            parts.push(g);
        }
        this.geometry?.dispose();
        this.geometry = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        this.bvh = new MeshBVH(this.geometry);
    }

    raycast(origin, dir, far = Infinity) {
        if (!this.bvh) return null;
        _ray.origin.copy(origin);
        _ray.direction.copy(dir);
        const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
        if (!hit) return null;
        const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        if (normal.dot(dir) > 0) normal.negate();
        return { distance: hit.distance, point: hit.point.clone(), normal };
    }

    lineOfSight(a, b) {
        _dir.subVectors(b, a);
        const d = _dir.length();
        _dir.divideScalar(d);
        return !this.raycast(a, _dir, d - 0.05);
    }

    // Distance to ground below a point (Infinity when there is none within `max`).
    groundBelow(p, max = 8) {
        const hit = this.raycast(p, new THREE.Vector3(0, -1, 0), max);
        return hit ? hit.distance : Infinity;
    }

    /**
     * Integrates a body: { pos (feet), vel, onGround }. Uses sub-steps to keep thin strokes solid.
     */
    move(body, dt) {
        const speed = body.vel.length() + PHYS.gravity * dt;
        const steps = THREE.MathUtils.clamp(Math.ceil(Math.max((speed * dt) / 0.1, dt * 120)), 1, 40);
        const h = dt / steps;
        let grounded = false;
        for (let i = 0; i < steps; i++) {
            if (this.step(body, h)) grounded = true;
        }
        body.onGround = grounded;
    }

    step(body, dt) {
        const r = PHYS.radius;
        body.vel.y -= PHYS.gravity * dt;
        body.pos.addScaledVector(body.vel, dt);
        if (!this.bvh) return false;

        _seg.start.set(body.pos.x, body.pos.y + r, body.pos.z);
        _seg.end.set(body.pos.x, body.pos.y + PHYS.height - r, body.pos.z);
        _box.makeEmpty();
        _box.expandByPoint(_seg.start);
        _box.expandByPoint(_seg.end);
        _box.min.addScalar(-r);
        _box.max.addScalar(r);

        let grounded = false;
        this.bvh.shapecast({
            intersectsBounds: (box) => box.intersectsBox(_box),
            intersectsTriangle: (tri) => {
                const dist = tri.closestPointToSegment(_seg, _triPt, _capPt);
                if (dist >= r) return false;
                if (dist > 1e-6) {
                    _dir.subVectors(_capPt, _triPt).divideScalar(dist);
                } else {
                    tri.getNormal(_n);
                    _center.addVectors(_seg.start, _seg.end).multiplyScalar(0.5);
                    if (_n.dot(_dir.subVectors(_center, _triPt)) < 0) _n.negate();
                    _dir.copy(_n);
                }
                const depth = r - dist;
                _seg.start.addScaledVector(_dir, depth);
                _seg.end.addScaledVector(_dir, depth);
                if (_dir.y > 0.55) grounded = true;
                return false;
            },
        });

        _delta.set(_seg.start.x - body.pos.x, _seg.start.y - r - body.pos.y, _seg.start.z - body.pos.z);
        body.pos.set(_seg.start.x, _seg.start.y - r, _seg.start.z);
        const len = _delta.length();
        if (len > 1e-7) {
            _delta.divideScalar(len);
            const into = body.vel.dot(_delta);
            if (into < 0) body.vel.addScaledVector(_delta, -into);
        }
        if (grounded && body.vel.y < 0) body.vel.y = 0;
        return grounded;
    }
}
