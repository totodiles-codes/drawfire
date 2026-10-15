import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StrokeSet } from '../src/strokeSet.js';

describe('stroke set', () => {
    it('moves kept strokes to the new team materials and disposes the old ones', () => {
        const set = new StrokeSet(new THREE.Scene());
        set.setTeams([0xff0000, 0x0000ff]);
        const old = set.materials;
        const kept = set.create({ team: 1, tool: 'ribbon' });
        const disposed = new Set();
        for (const m of old) {
            for (const mat of [m.face, m.edge]) mat.addEventListener('dispose', () => disposed.add(mat));
        }
        // 'KEEP DRAWING': the next match starts with the same strokes
        set.setTeams([0x00ff00, 0xffff00]);
        expect(kept.mesh.material[0]).toBe(set.materials[1].face);
        expect(kept.mesh.material[1]).toBe(set.materials[1].edge);
        expect(set.materials[1].face).not.toBe(old[1].face);
        expect(disposed.size).toBe(4);
    });
});
