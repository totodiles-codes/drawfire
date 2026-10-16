import { describe, expect, it } from 'vitest';
import { Astronaut } from '../src/character.js';

function resources(avatar) {
    const list = new Set();
    avatar.root.traverse((o) => {
        if (!o.isMesh) return;
        list.add(o.geometry);
        list.add(o.material);
    });
    return [...list];
}

describe('Astronaut.dispose', () => {
    it('frees only its own colour materials, not what other astronauts share', () => {
        const other = new Astronaut(0x7062e6);
        const avatar = new Astronaut(0xe2683a);
        const disposed = new Set();
        for (const r of resources(avatar)) r.addEventListener('dispose', () => disposed.add(r));

        avatar.dispose();
        expect([...disposed]).toEqual(expect.arrayContaining([avatar.mat, avatar.lightMat]));
        expect(disposed.size).toBe(2);
        expect(resources(other).filter((r) => disposed.has(r))).toEqual([]);
    });
});
