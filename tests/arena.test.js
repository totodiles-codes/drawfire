import { describe, expect, it } from 'vitest';
import { MODES, TEAM_COLORS, FFA_COLORS } from '../src/config.js';
import { buildArena, disposeArena } from '../src/arena.js';

function resources(arena) {
    const geometries = new Set();
    const materials = new Set();
    arena.group.traverse((o) => {
        if (!o.isMesh) return;
        geometries.add(o.geometry);
        materials.add(o.material);
    });
    return { geometries, materials };
}

describe('disposeArena', () => {
    for (const mode of [MODES.duel4, MODES.ffa]) {
        it(`frees everything a ${mode.id} build made, but nothing another arena still uses`, () => {
            const colors = mode.layout === 'duel' ? TEAM_COLORS : FFA_COLORS.slice(0, mode.teamCount);
            const old = resources(buildArena(mode, colors));
            const arena = buildArena(mode, colors);
            const own = resources(arena);
            const disposed = new Set();
            for (const r of [...own.geometries, ...own.materials]) r.addEventListener('dispose', () => disposed.add(r));

            disposeArena(arena);
            const shared = [...own.materials].filter((m) => old.materials.has(m));
            expect(shared.length).toBeGreaterThan(0);
            expect(shared.filter((m) => disposed.has(m))).toEqual([]);
            // the team-coloured spawn rings
            expect([...own.materials].filter((m) => disposed.has(m))).toHaveLength(mode.teamCount);
            expect([...own.geometries].filter((g) => !disposed.has(g))).toEqual([]);
        });
    }
});
