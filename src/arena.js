import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SURFACE_WHITE } from './config.js';

// Static orbital arena: spawn bases, connecting bridges and team-coloured spawn rings.

const whiteMat = new THREE.MeshStandardMaterial({ color: SURFACE_WHITE, roughness: 0.9, metalness: 0 });
const underMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcc, roughness: 0.9, metalness: 0 });
const slotMat = new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.6 });

function shadowed(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function spawnRing(color, radius) {
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        emissive: color,
        emissiveIntensity: 0.25,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.13, 10, 64), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    ring.receiveShadow = true;
    return ring;
}

function squareBase(size, color) {
    const g = new THREE.Group();
    const top = shadowed(new THREE.Mesh(new RoundedBoxGeometry(size, 1.6, size, 3, 0.28), whiteMat));
    top.position.y = -0.8;
    const lower = shadowed(new THREE.Mesh(new RoundedBoxGeometry(size - 1.4, 1.4, size - 1.4, 3, 0.3), underMat));
    lower.position.y = -2.2;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, size * 0.38), slotMat);
    slot.position.set(size / 2 - 1.6, 0.01, size * 0.12);
    g.add(top, lower, slot, spawnRing(color, 2.3));
    return { group: g, colliders: [top, lower] };
}

function roundPad(radius, color) {
    const g = new THREE.Group();
    const top = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.4, 48), whiteMat));
    top.position.y = -0.7;
    const lower = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.8, radius - 0.4, 1.2, 48), underMat));
    lower.position.y = -2.0;
    g.add(top, lower, spawnRing(color, Math.min(2.2, radius * 0.45)));
    return { group: g, colliders: [top, lower] };
}

function bridge(length, width = 3) {
    const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(width, 0.8, length), whiteMat));
    mesh.position.y = -0.4;
    return mesh;
}

/**
 * Builds the arena for a mode. Returns meshes for rendering + collision, spawn points per team,
 * drawing bounds, no-draw zones around spawns and the default overview camera.
 */
export function buildArena(mode, teamColors) {
    const group = new THREE.Group();
    const colliders = [];
    const spawns = [];
    const noDraw = [];
    let bounds;
    let view;

    if (mode.layout === 'duel') {
        const L = mode.length;
        const S = mode.baseSize;
        for (let team = 0; team < 2; team++) {
            const z = team === 0 ? L / 2 : -L / 2;
            const base = squareBase(S, teamColors[team]);
            base.group.position.z = z;
            group.add(base.group);
            colliders.push(...base.colliders);
            const yaw = team === 0 ? 0 : Math.PI;
            spawns[team] = { center: new THREE.Vector3(0, 0, z), radius: 2.0, yaw, area: S / 2 - 1.5 };
            noDraw.push({ center: new THREE.Vector3(0, 0, z), radius: 3.4 });
        }
        const br = bridge(L - S + 0.6);
        group.add(br);
        colliders.push(br);
        bounds = new THREE.Box3(new THREE.Vector3(-34, -14, -L / 2 - 14), new THREE.Vector3(34, 32, L / 2 + 14));
        view = {
            target: new THREE.Vector3(0, 0, L * 0.12),
            azimuth: 0,
            elevation: 0.56,
            distance: L * 0.85 + 12,
        };
    } else {
        const R = mode.radius;
        const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.2, 48), whiteMat));
        hub.position.y = -0.6;
        group.add(hub);
        colliders.push(hub);
        for (let team = 0; team < mode.teamCount; team++) {
            const ang = (team / mode.teamCount) * Math.PI * 2;
            const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
            const pad = roundPad(5.2, teamColors[team]);
            pad.group.position.copy(dir).multiplyScalar(R);
            group.add(pad.group);
            colliders.push(...pad.colliders);
            const spokeLen = R - 5.2 - 7 + 1.2;
            const sp = bridge(spokeLen, 2.6);
            sp.position.copy(dir).multiplyScalar(7 + spokeLen / 2 - 0.6);
            sp.position.y = -0.4;
            sp.rotation.y = ang;
            group.add(sp);
            colliders.push(sp);
            spawns[team] = { center: dir.clone().multiplyScalar(R), radius: 1.6, yaw: ang, area: 3.4 };
            noDraw.push({ center: dir.clone().multiplyScalar(R), radius: 3.2 });
        }
        bounds = new THREE.Box3(new THREE.Vector3(-R - 14, -14, -R - 14), new THREE.Vector3(R + 14, 32, R + 14));
        view = { target: new THREE.Vector3(0, 0, 8), azimuth: 0, elevation: 0.72, distance: R * 1.6 + 8 };
    }

    for (const c of colliders) c.updateWorldMatrix(true, false);
    group.updateMatrixWorld(true);
    return { group, colliders, spawns, noDraw, bounds, view };
}

// Frees what buildArena() made for one arena: every geometry and the team-coloured spawn-ring materials.
// The surface materials above are shared by every arena, so they stay.
export function disposeArena(arena) {
    arena.group.traverse((o) => {
        if (!o.isMesh) return;
        if (![whiteMat, underMat, slotMat].includes(o.material)) o.material.dispose();
        o.geometry.dispose();
    });
}

export function inNoDrawZone(arena, p) {
    for (const z of arena.noDraw) {
        const dx = p.x - z.center.x;
        const dz = p.z - z.center.z;
        if (dx * dx + dz * dz < z.radius * z.radius && p.y > -2 && p.y < 5) return true;
    }
    return false;
}
