import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STEPS, advance, dummySpots, isRampStroke } from '../src/tutorial.js';
import { MODES, TEAM_COLORS } from '../src/config.js';
import { buildArena } from '../src/arena.js';
import { World } from '../src/physics.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const snap = (over = {}) => ({
    strokes: [],
    ready: false,
    turned: 0,
    fight: false,
    fightState: null,
    walked: 0,
    doubleJumps: 0,
    glide: 0,
    hits: { rifle: 0, launcher: 0, aimed: 0 },
    ...over,
});

describe('isRampStroke', () => {
    it('accepts a ribbon slope and rejects flat, vertical and ground strokes', () => {
        expect(isRampStroke({ tool: 'ribbon', points: [v(0, 0, 0), v(6, 3, 0)] })).toBe(true);
        expect(isRampStroke({ tool: 'ribbon', points: [v(0, 0, 0), v(8, 0.2, 0)] })).toBe(false);
        expect(isRampStroke({ tool: 'ribbon', points: [v(0, 0, 0), v(0.5, 6, 0)] })).toBe(false);
        expect(isRampStroke({ tool: 'ground', points: [v(0, 0, 0), v(6, 3, 0)] })).toBe(false);
    });
});

describe('advance', () => {
    it('ticks off steps in order and skips ones already done out of order', () => {
        const ramp = { tool: 'ribbon', points: [v(0, 0, 0), v(6, 3, 0)], closed: false };
        const path = { tool: 'ground', points: [v(0, 0, 0), v(9, 0, 0)], closed: false };
        const platform = { tool: 'ground', points: [v(0, 0, 0)], closed: true };
        expect(advance(STEPS, 0, snap())).toBe(0);
        // path drawn before the ramp: nothing moves until the ramp exists
        expect(advance(STEPS, 0, snap({ strokes: [path] }))).toBe(0);
        // then both complete at once, and the platform already counts too
        expect(advance(STEPS, 0, snap({ strokes: [path, ramp, platform] }))).toBe(3);
    });

    it('never goes backwards', () => {
        expect(advance(STEPS, 5, snap())).toBe(5);
    });

    it('covers every fight step with the counters the controller keeps', () => {
        const first = STEPS.findIndex((s) => s.phase === 'fight');
        const all = snap({
            fight: true,
            fightState: 'live',
            walked: 9,
            doubleJumps: 1,
            glide: 1,
            hits: { rifle: 2, launcher: 1, aimed: 1 },
        });
        expect(advance(STEPS, first, all)).toBe(STEPS.length);
    });
});

describe('dummySpots', () => {
    it('puts every dummy on solid ground in front of the player', () => {
        const arena = buildArena(MODES.tutorial, TEAM_COLORS);
        const world = new World();
        world.build(arena.colliders);
        const spots = dummySpots(arena, MODES.tutorial.dummies);
        expect(spots).toHaveLength(MODES.tutorial.dummies);
        for (const p of spots) {
            expect(world.groundBelow(p.clone().setY(1), 6)).toBeLessThan(3);
            // in front of the spawn (spawn faces -z)
            expect(p.z).toBeLessThan(arena.spawns[0].center.z);
        }
    });
});
