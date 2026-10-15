import * as THREE from 'three';
import { SURFACE_WHITE, STROKE } from './config.js';
import { isClosedStroke, polylineLength, strokeGeometry } from './strokes.js';

const WHITE = new THREE.Color(SURFACE_WHITE);

// One drawn shape. Raw points are kept so geometry can be rebuilt while it grows.
export class Stroke {
    constructor(set, { team, owner, tool, planeNormal, planeY = 0, width, thickness, smooth }) {
        this.set = set;
        this.team = team;
        this.owner = owner;
        this.tool = tool;
        this.planeNormal = planeNormal ? planeNormal.clone() : new THREE.Vector3(0, 0, 1);
        this.planeY = planeY;
        this.width = width;
        this.thickness = thickness;
        this.smooth = smooth;
        this.points = [];
        this.closed = false;
        this.length = 0;
        this.final = false;
        const mats = set.materials[team];
        this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), [mats.face, mats.edge]);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData.stroke = this;
        set.group.add(this.mesh);
    }

    // Returns the ink used by this point (0 if rejected because it is too close to the last one).
    addPoint(p, minGap = STROKE.minPointGap) {
        const last = this.points[this.points.length - 1];
        if (last) {
            const d = last.distanceTo(p);
            if (d < minGap) return 0;
            this.points.push(p.clone());
            this.length += d;
            return d;
        }
        this.points.push(p.clone());
        return 0;
    }

    // maxGap: extra closing tolerance in metres (the draw phase converts a screen distance)
    rebuild(final = false, maxGap = 0) {
        this.final = final;
        if (final) this.closed = isClosedStroke(this.points, maxGap);
        const old = this.mesh.geometry;
        this.mesh.geometry = this.points.length >= 2 ? strokeGeometry(this, final) : new THREE.BufferGeometry();
        old.dispose();
        if (final) this.length = polylineLength(this.points);
    }

    dispose() {
        this.set.group.remove(this.mesh);
        this.mesh.geometry.dispose();
    }
}

// All strokes of the match plus the per-team material pairs (face + edge trim).
export class StrokeSet {
    constructor(scene) {
        this.group = new THREE.Group();
        scene.add(this.group);
        this.strokes = [];
        this.materials = [];
        this.colors = [];
        this.look = 0;
    }

    setTeams(colors) {
        const old = this.materials;
        this.colors = colors.map((c) => new THREE.Color(c));
        this.materials = this.colors.map((c) => ({
            face: new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.55, metalness: 0 }),
            edge: new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.5, metalness: 0 }),
        }));
        for (const s of this.strokes) {
            const mats = this.materials[s.team];
            s.mesh.material = [mats.face, mats.edge];
        }
        // strokes kept from the last match ('KEEP DRAWING') now use the new pairs, so nothing uses the old ones
        for (const m of old) {
            m.face.dispose();
            m.edge.dispose();
        }
        this.setFightLook(this.look);
    }

    create(opts) {
        const s = new Stroke(this, opts);
        this.strokes.push(s);
        return s;
    }

    remove(stroke) {
        const i = this.strokes.indexOf(stroke);
        if (i >= 0) this.strokes.splice(i, 1);
        stroke.dispose();
    }

    clear() {
        for (const s of this.strokes) s.dispose();
        this.strokes = [];
    }

    meshes() {
        return this.strokes.filter((s) => s.points.length >= 2).map((s) => s.mesh);
    }

    // 0 = drawing look (solid team colour), 1 = fight look (white faces, coloured trims)
    setFightLook(t) {
        this.look = t;
        this.materials.forEach((m, i) => {
            m.face.color.copy(this.colors[i]).lerp(WHITE, t);
            m.face.roughness = 0.55 + 0.3 * t;
        });
    }
}
