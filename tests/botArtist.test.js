import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODES, TEAM_COLORS, FFA_COLORS, STROKE } from '../src/config.js';
import { buildArena, inNoDrawZone } from '../src/arena.js';
import { BotArtist, TEAM_CAP, planShapes } from '../src/botArtist.js';
import { isClosedStroke, polylineLength, strokeGeometry } from '../src/strokes.js';
import { Rng } from '../src/rng.js';

describe('bot shape planning', () => {
    for (const mode of Object.values(MODES)) {
        it(`keeps ${mode.id} plans inside the arena, out of spawns and within budget`, () => {
            const colors = mode.layout === 'duel' ? TEAM_COLORS : FFA_COLORS;
            const arena = buildArena(mode, colors);
            for (let seed = 1; seed <= 25; seed++) {
                const team = seed % mode.teamCount;
                const plan = planShapes(new Rng(seed), team, mode, arena, { maxShapes: 6 });
                expect(plan.length).toBeGreaterThan(0);
                expect(plan.length).toBeLessThanOrEqual(6);
                let ink = 0;
                for (const desc of plan) {
                    ink += polylineLength(desc.points);
                    for (const p of desc.points) {
                        expect(arena.bounds.containsPoint(p)).toBe(true);
                        expect(inNoDrawZone(arena, p)).toBe(false);
                    }
                }
                expect(ink).toBeLessThanOrEqual(STROKE.ink);
            }
        });
    }

    it('puts platform tops where the recipe meant them and uses the wall tool for cover', () => {
        const mode = MODES.duel4;
        const arena = buildArena(mode, TEAM_COLORS);
        let platforms = 0;
        for (let seed = 1; seed <= 40; seed++) {
            for (const d of planShapes(new Rng(seed), seed % 2, mode, arena, { maxShapes: 7 })) {
                if (d.tool !== 'ground') continue;
                const closed = isClosedStroke(d.points);
                const geo = strokeGeometry({ ...d, closed }, true);
                geo.computeBoundingBox();
                // ground strokes (paths and platforms) always top out just above their plane
                expect(geo.boundingBox.max.y).toBeCloseTo(d.planeY + STROKE.groundLift, 1);
                if (closed) platforms++;
                // short open ground lines were the old cover walls; those are wall strokes now
                if (!closed) expect(polylineLength(d.points)).toBeGreaterThan(9);
            }
        }
        expect(platforms).toBeGreaterThan(0);
    });

    it('respects per-team caps shared between bots', () => {
        const mode = MODES.duel4;
        const arena = buildArena(mode, TEAM_COLORS);
        const counts = new Map();
        for (let i = 0; i < 6; i++) planShapes(new Rng(100 + i), 0, mode, arena, { maxShapes: 7, teamCounts: counts });
        for (const [recipe, n] of counts) {
            if (TEAM_CAP.has(recipe)) expect(n).toBeLessThanOrEqual(TEAM_CAP.get(recipe));
        }
    });
});

// Records what a bot does to its strokes instead of building geometry.
function fakeStrokes() {
    const created = [];
    return {
        created,
        create(opts) {
            const stroke = {
                opts,
                points: [],
                rebuilds: [],
                addPoint(p) {
                    this.points.push(p.clone());
                },
                rebuild(final = false) {
                    this.rebuilds.push({ final, count: this.points.length });
                },
            };
            created.push(stroke);
            return stroke;
        },
    };
}

function makeArtist(strokes, seed = 3) {
    const mode = MODES.duel4;
    return new BotArtist({
        who: { team: 1, name: 'BOT', color: TEAM_COLORS[1] },
        strokes,
        arena: buildArena(mode, TEAM_COLORS),
        mode,
        hud: { createCursor: () => ({ set() {}, remove() {} }) },
        rng: new Rng(seed),
    });
}

describe('bot drawing', () => {
    it('rebuilds a growing stroke only now and then, and exactly once it is done', () => {
        const strokes = fakeStrokes();
        const bot = makeArtist(strokes);
        const points = [];
        for (let i = 0; i <= 120; i++) points.push(new THREE.Vector3(i * 0.45, 2, 0));
        bot.current = { desc: { tool: 'ribbon', planeNormal: new THREE.Vector3(1, 0, 0), points } };
        bot.beginStroke();
        let time = 0;
        while (bot.state === 'draw') {
            bot.advance(1 / 60);
            time += 1 / 60;
        }
        const [stroke] = strokes.created;
        const live = stroke.rebuilds.filter((r) => !r.final);
        expect(stroke.rebuilds.filter((r) => r.final)).toHaveLength(1);
        expect(stroke.rebuilds.at(-1)).toEqual({ final: true, count: points.length });
        // live feedback about every 0.07 s (the stroke keeps up with the cursor), and only when points were added
        expect(live.length).toBeGreaterThan(time / 0.1);
        expect(live.length).toBeLessThanOrEqual(Math.ceil(time / 0.07) + 1);
        for (let i = 1; i < live.length; i++) expect(live[i].count).toBeGreaterThan(live[i - 1].count);
    });

    it('creates strokes the same way when drawing them and when finishing instantly', () => {
        const strokes = fakeStrokes();
        const bot = makeArtist(strokes);
        const plan = [...bot.plan];
        expect(plan.length).toBeGreaterThan(1);
        bot.next();
        bot.beginStroke();
        bot.finishAll();
        expect(strokes.created).toHaveLength(plan.length);
        strokes.created.forEach((s, i) => {
            const d = plan[i];
            expect(s.opts).toEqual({
                team: 1,
                owner: bot.who,
                tool: d.tool,
                planeNormal: d.planeNormal,
                planeY: d.planeY ?? 0,
                width: d.width,
                thickness: d.thickness,
                smooth: d.smooth,
            });
            expect(s.points).toHaveLength(d.points.length);
            expect(s.rebuilds.at(-1).final).toBe(true);
        });
    });
});
