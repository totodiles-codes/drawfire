import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PHYS } from '../src/config.js';
import { PlayerController } from '../src/player.js';

const DT = 1 / 60;
// accepts any method call (hud, sfx, effects)
const noop = new Proxy({}, { get: () => () => {} });
const listeners = { addEventListener() {}, removeEventListener() {} };

// A live match with one player on flat ground; world.move just integrates velocity.
function setup() {
    const game = {
        settings: { sensitivity: 1, aimMode: 'hold' },
        gfx: {
            camera: new THREE.PerspectiveCamera(75, 1, 0.05, 2000),
            viewCamera: new THREE.PerspectiveCamera(62, 1, 0.01, 10),
            viewScene: new THREE.Scene(),
            renderer: { domElement: listeners },
            layers: { view: { enabled: false } },
        },
        hud: noop,
        sfx: noop,
    };
    const shots = [];
    const fight = {
        game,
        state: 'live',
        live: true,
        paused: false,
        lock: { pending: false },
        lockDenied: false,
        effects: noop,
        world: { move: (body, dt) => body.pos.addScaledVector(body.vel, dt) },
        fireHitscan: (shooter, origin, dir) => shots.push({ origin: origin.clone(), dir: dir.clone() }),
    };
    const f = {
        alive: true,
        color: 0xff3366,
        yaw: 0,
        pitch: 0,
        jumpsLeft: 1,
        body: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: true },
    };
    const pc = new PlayerController(fight, f);
    pc.locked = true;
    return { game, fight, f, pc, shots };
}

const look = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

beforeEach(() => {
    // no rifle spread, so shot directions can be compared exactly
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('window', listeners);
    vi.stubGlobal('document', { body: { classList: { toggle() {}, remove() {} } } });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('PlayerController shots', () => {
    it("fire from this frame's eye and look, even when the yaw changed this frame", () => {
        const { f, pc, shots, game } = setup();
        pc.update(DT);
        // sprinting sideways, then turn 90 degrees and fire in the same frame
        f.body.vel.set(PHYS.sprint, 0, 0);
        f.yaw = Math.PI / 2;
        pc.fire = true;
        pc.update(DT);

        expect(shots).toHaveLength(1);
        const eye = f.body.pos.clone().add(new THREE.Vector3(0, PHYS.eye, 0));
        expect(shots[0].origin.distanceTo(eye)).toBeLessThan(1e-6);
        expect(shots[0].dir.dot(look(Math.PI / 2))).toBeGreaterThan(0.999999);
        // the rendered camera still shows this frame's recoil kick
        expect(f.pitch).toBeGreaterThan(0);
        expect(game.gfx.camera.rotation.x).toBeCloseTo(f.pitch, 6);
    });

    it("include this frame's edge turn (free-mouse aiming)", () => {
        const { f, pc, shots } = setup();
        pc.update(DT);
        pc.locked = false;
        pc.cursor = { x: 0, y: 0.5, inside: true };
        pc.fire = true;
        pc.update(DT);

        expect(f.yaw).toBeGreaterThan(0.01);
        expect(shots).toHaveLength(1);
        expect(shots[0].dir.dot(look(f.yaw))).toBeGreaterThan(0.999999);
    });
});

describe('PlayerController.dispose', () => {
    it('removes the viewmodel and disposes all of its geometries and materials', () => {
        const { game, pc } = setup();
        const disposed = new Set();
        const owned = new Set();
        pc.vm.root.traverse((o) => {
            if (!o.isMesh) return;
            for (const r of [o.geometry, o.material]) {
                owned.add(r);
                r.addEventListener('dispose', () => disposed.add(r));
            }
        });
        expect(owned.size).toBeGreaterThan(15);

        pc.dispose();

        expect(game.gfx.viewScene.children).not.toContain(pc.vm.root);
        expect(disposed.size).toBe(owned.size);
    });
});
