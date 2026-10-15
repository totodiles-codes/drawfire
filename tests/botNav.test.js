import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FFA_COLORS, MODES, PHYS, TEAM_COLORS } from '../src/config.js';
import { buildArena } from '../src/arena.js';
import { planShapes } from '../src/botArtist.js';
import { isClosedStroke, strokeGeometry } from '../src/strokes.js';
import { World } from '../src/physics.js';
import { BotBrain } from '../src/bot.js';
import { Rng } from '../src/rng.js';

// Headless match: bots navigate a generated map (no shooting) and we count how many walk off it.
function simulate(modeId, seed, seconds) {
    const mode = MODES[modeId];
    const colors = mode.layout === 'duel' ? TEAM_COLORS : FFA_COLORS;
    const arena = buildArena(mode, colors);
    const rng = new Rng(seed);
    const meshes = [...arena.colliders];
    for (let team = 0; team < mode.teamCount; team++) {
        const bots = mode.layout === 'duel' ? mode.perTeam : 1;
        for (let b = 0; b < bots; b++) {
            for (const desc of planShapes(new Rng(rng.int(1, 1e9)), team, mode, arena, { maxShapes: 4 })) {
                const stroke = { ...desc, planeY: desc.planeY ?? 0, closed: isClosedStroke(desc.points) };
                meshes.push(new THREE.Mesh(strokeGeometry(stroke, true)));
            }
        }
    }
    const world = new World();
    world.build(meshes);

    const fight = { world, fighters: [], game: { arena, mode }, clock: 0, live: true, fireHitscan: () => {} };
    for (let team = 0; team < mode.teamCount; team++) {
        const count = mode.layout === 'duel' ? mode.perTeam : 1;
        for (let i = 0; i < count; i++) {
            const sp = arena.spawns[team];
            const a = rng.range(0, Math.PI * 2);
            const r = rng.range(0, sp.area * 0.7);
            const f = {
                name: `${team}-${i}`,
                team,
                isPlayer: false,
                alive: true,
                yaw: sp.yaw,
                pitch: 0,
                jumpsLeft: 1,
                body: {
                    pos: new THREE.Vector3(sp.center.x + Math.cos(a) * r, 0.2, sp.center.z + Math.sin(a) * r),
                    vel: new THREE.Vector3(),
                    onGround: false,
                },
                muzzle() {
                    return this.body.pos.clone();
                },
            };
            f.brain = new BotBrain(fight, f, new Rng(rng.int(1, 1e9)));
            f.brain.onSpawn();
            fight.fighters.push(f);
        }
    }

    let falls = 0;
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) {
        fight.clock = t;
        for (const f of fight.fighters) {
            f.brain.update(dt);
            if (f.body.pos.y < PHYS.killY) {
                falls++;
                const sp = arena.spawns[f.team];
                f.body.pos.set(sp.center.x, 0.2, sp.center.z);
                f.body.vel.set(0, 0, 0);
                f.brain.onSpawn();
            }
        }
    }
    return { falls, bots: fight.fighters.length };
}

describe('bot navigation', () => {
    it('4v4 bots mostly stay on the map', () => {
        const { falls, bots } = simulate('duel4', 7, 40);
        expect(falls).toBeLessThanOrEqual(Math.ceil(bots * 0.25));
    }, 30000);

    it('free-for-all bots use the spokes instead of jumping off pads', () => {
        const { falls, bots } = simulate('ffa', 11, 40);
        expect(falls).toBeLessThanOrEqual(Math.ceil(bots * 0.25));
    }, 30000);
});
