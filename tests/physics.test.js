import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/physics.js';
import { buildBandGeometry, resampleStroke } from '../src/strokes.js';

function body(x, y, z) {
    return { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), onGround: false };
}

function floor(size = 20, thickness = 1, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, thickness, size));
    m.position.y = y - thickness / 2;
    return m;
}

function simulate(world, b, seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) world.move(b, dt);
}

describe('World', () => {
    it('lands a falling capsule on the floor', () => {
        const world = new World();
        world.build([floor()]);
        const b = body(0, 5, 0);
        simulate(world, b, 2);
        expect(b.pos.y).toBeCloseTo(0, 1);
        expect(b.onGround).toBe(true);
    });

    it('does not tunnel through a thin drawn ribbon, even with long frames', () => {
        const path = resampleStroke([new THREE.Vector3(-6, 0, 0), new THREE.Vector3(6, 0, 0)], 0.45);
        const ribbon = new THREE.Mesh(
            buildBandGeometry(path, { widthDir: new THREE.Vector3(0, 0, 1), thickness: 0.42 }),
        );
        const world = new World();
        world.build([ribbon]);
        const b = body(0, 25, 0);
        simulate(world, b, 3, 0.1);
        expect(b.pos.y).toBeGreaterThan(0);
        expect(b.pos.y).toBeLessThan(0.5);
    });

    it('blocks horizontal movement through walls', () => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 10));
        wall.position.set(3, 2, 0);
        const world = new World();
        world.build([floor(), wall]);
        const b = body(0, 0.05, 0);
        for (let i = 0; i < 120; i++) {
            b.vel.x = 9;
            world.move(b, 1 / 60);
        }
        expect(b.pos.x).toBeLessThan(3 - 0.25 - 0.35);
    });

    it('raycasts and checks line of sight', () => {
        const world = new World();
        world.build([floor()]);
        const hit = world.raycast(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 10);
        expect(hit.distance).toBeCloseTo(5, 3);
        expect(hit.normal.y).toBeCloseTo(1, 3);
        expect(world.lineOfSight(new THREE.Vector3(-5, 1, 0), new THREE.Vector3(5, 1, 0))).toBe(true);
        expect(world.lineOfSight(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -3, 0))).toBe(false);
    });
});
