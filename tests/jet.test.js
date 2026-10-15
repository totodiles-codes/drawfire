import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { JET, MODES, PHYS, TEAM_COLORS } from '../src/config.js';
import { createJet, jetStep } from '../src/jet.js';
import { buildArena } from '../src/arena.js';
import { World } from '../src/physics.js';
import { BotBrain } from '../src/bot.js';
import { Rng } from '../src/rng.js';

const DT = 1 / 60;

// Airborne integration like the game: jetStep, then gravity (as World.move applies it).
function fly(jet, vy, seconds, { hold = true, armed = true } = {}) {
    const trace = [];
    for (let t = 0; t < seconds; t += DT) {
        vy = jetStep(jet, { hold, armed, onGround: false, vy, dt: DT });
        vy -= PHYS.gravity * DT;
        trace.push(vy);
    }
    return trace;
}

describe('jetStep', () => {
    it('settles the fall at the glide speed after the double jump', () => {
        const trace = fly(createJet(), PHYS.doubleJump, 1.0);
        expect(trace[trace.length - 1]).toBeCloseTo(-JET.fall, 1);
    });

    it('never adds height: rising or slow sinking is left alone', () => {
        const jet = createJet();
        for (const vy of [8, 2, 0, -1, -2]) {
            expect(jetStep(jet, { hold: true, armed: true, onGround: false, vy, dt: DT })).toBe(vy);
        }
        expect(jet.fuel).toBe(JET.fuel);
    });

    it('free-falls once the fuel is gone', () => {
        const jet = createJet();
        const trace = fly(jet, -10, JET.fuel + 1);
        expect(jet.fuel).toBe(0);
        expect(trace[trace.length - 1]).toBeLessThan(-JET.fall - 10);
    });

    it('does nothing before the double jump or without holding', () => {
        expect(fly(createJet(), -10, 0.5, { armed: false }).pop()).toBeLessThan(-20);
        expect(fly(createJet(), -10, 0.5, { hold: false }).pop()).toBeLessThan(-20);
    });

    it('refills on the ground', () => {
        const jet = createJet();
        jet.fuel = 0;
        for (let t = 0; t < JET.refill + 0.05; t += DT) {
            jetStep(jet, { hold: false, armed: false, onGround: true, vy: 0, dt: DT });
        }
        expect(jet.fuel).toBeCloseTo(JET.fuel, 5);
    });
});

describe('bots and the jet', () => {
    // A bot knocked off the side of its base, double jump already spent.
    function knockedOff(fuel) {
        const mode = MODES.duel4;
        const arena = buildArena(mode, TEAM_COLORS);
        const world = new World();
        world.build(arena.colliders);
        const fight = { world, fighters: [], game: { arena, mode }, clock: 0, live: true, fireHitscan: () => {} };
        const base = arena.spawns[0].center;
        const f = {
            name: 'b',
            team: 0,
            isPlayer: false,
            alive: true,
            yaw: 0,
            pitch: 0,
            jumpsLeft: 0,
            body: { pos: base.clone().setY(0.2), vel: new THREE.Vector3(), onGround: true },
            muzzle() {
                return this.body.pos.clone();
            },
        };
        fight.fighters.push(f);
        f.brain = new BotBrain(fight, f, new Rng(3));
        f.brain.onSpawn();
        f.brain.jet.fuel = fuel;
        f.body.pos.set(base.x + 11, 4, base.z);
        f.body.vel.set(5, -2, 0);
        f.body.onGround = false;
        for (let t = 0; t < 4; t += 1 / 30) {
            fight.clock = t;
            f.brain.update(1 / 30);
        }
        return f.body.pos;
    }

    it('glides back to the base instead of falling into the void', () => {
        expect(knockedOff(JET.fuel).y).toBeGreaterThan(-1);
    }, 20000);

    it('falls without fuel, so the jet is what saves it', () => {
        expect(knockedOff(0).y).toBeLessThan(-10);
    }, 20000);
});
