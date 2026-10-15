import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Effects } from '../src/effects.js';

// The glow texture is drawn on a canvas; a stub is enough outside the browser.
const canvasStub = () => ({
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
});

describe('Effects.dispose', () => {
    beforeEach(() => vi.stubGlobal('document', { createElement: canvasStub }));
    afterEach(() => vi.unstubAllGlobals());

    it('frees the texture, geometries and every live beam / flash material', () => {
        const scene = new THREE.Scene();
        const fx = new Effects(scene);
        fx.beam(new THREE.Vector3(), new THREE.Vector3(0, 0, -5), 0xff0000);
        fx.flash(new THREE.Vector3(), 0xff0000, 1, 0.1);
        const owned = [
            fx.tex,
            fx.beamGeo,
            fx.sparks.geometry,
            fx.sparks.material,
            ...fx.beams.flatMap((b) => b.parts.map((m) => m.material)),
            ...fx.sprites.map((s) => s.s.material),
        ];
        const disposed = new Set();
        for (const o of owned) o.addEventListener('dispose', () => disposed.add(o));

        fx.dispose();
        expect(owned.filter((o) => !disposed.has(o))).toEqual([]);
        expect(scene.children).toHaveLength(0);
    });
});
