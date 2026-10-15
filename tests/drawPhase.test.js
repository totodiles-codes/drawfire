import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DrawPhase, pickGround } from '../src/drawPhase.js';
import { isClosedStroke } from '../src/strokes.js';

// the real closed-loop test, wrapped so the guide cache can be counted
vi.mock('../src/strokes.js', async (importOriginal) => {
    const mod = await importOriginal();
    return { ...mod, isClosedStroke: vi.fn(mod.isClosedStroke) };
});

function box(w, h, d, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.updateMatrixWorld(true);
    return m;
}

// The two-tier spawn base from arena.js: top slab y -1.6..0, lower slab y -2.9..-1.5.
const base = [box(14, 1.6, 14, 0, -0.8, 0), box(12.6, 1.4, 12.6, 0, -2.2, 0)];

function cast(meshes, from, to) {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    return new THREE.Raycaster(from, dir).intersectObjects(meshes, false);
}

describe('pickGround', () => {
    it('accepts the top of the base', () => {
        const hit = pickGround(cast(base, new THREE.Vector3(1, 10, 2), new THREE.Vector3(1, 0, 2)));
        expect(hit).not.toBeNull();
        expect(hit.point.y).toBeCloseTo(0, 5);
    });

    it('rejects a side face instead of drawing at half height (or under the base)', () => {
        const hits = cast(base, new THREE.Vector3(0, 1, 20), new THREE.Vector3(0, -0.8, 7));
        expect(hits[0].point.z).toBeCloseTo(7, 3);
        expect(pickGround(hits)).toBeNull();
    });

    it('accepts the top of a rotated spoke', () => {
        const spoke = box(2.6, 0.8, 20, 5, -0.4, 5, 0.785);
        const hit = pickGround(cast([spoke], new THREE.Vector3(5, 8, 5), new THREE.Vector3(5, 0, 5)));
        expect(hit?.point.y).toBeCloseTo(0, 5);
    });

    it('looks past wall strokes to the floor behind them', () => {
        const wall = box(10, 3, 0.4, 0, 1.4, 3);
        wall.userData.stroke = { tool: 'wall' };
        const hits = cast([wall, ...base], new THREE.Vector3(0, 6, 12), new THREE.Vector3(0, 0, -2));
        expect(hits[0].object).toBe(wall);
        const hit = pickGround(hits);
        expect(hit.object).toBe(base[0]);
        expect(hit.point.y).toBeCloseTo(0, 5);
    });
});

// A headless DrawPhase: just enough of the game, HUD and DOM for its constructor, input and guides.
function makePhase(opts = { attract: true, bots: false, spin: 0 }) {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const game = {
        arena: { view: { target: new THREE.Vector3(), azimuth: 0, elevation: 0.6, distance: 60 } },
        me: { team: 0, color: 0xff5500 },
        roster: [],
        gfx: {
            camera,
            scene: new THREE.Scene(),
            renderer: { domElement: Object.assign(new EventTarget(), { clientWidth: 1280, clientHeight: 720 }) },
        },
        hud: {
            caption: vi.fn(),
            subtitle: vi.fn(),
            createCursor: () => ({ set() {}, remove() {} }),
            showDrawBar() {},
            hideDrawBar() {},
        },
        sfx: { click: vi.fn(), setScribble() {} },
        strokes: { remove: vi.fn() },
    };
    return new DrawPhase(game, opts);
}

const press = (code, key, repeat = false) => ({ code, key, repeat, preventDefault: vi.fn() });

beforeEach(() => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { classList: { add() {}, remove() {} } } }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DrawPhase hotkeys', () => {
    it('AZERTY: the key that prints z (physical W) tilts the view but never undoes', () => {
        const p = makePhase();
        p.myStrokes.push({ length: 4 });
        const elevation = p.orbitGoal.elevation;
        p.onKey(press('KeyW', 'z'), true);
        p.updateCamera(0.1);
        expect(p.orbitGoal.elevation).toBeGreaterThan(elevation);
        expect(p.myStrokes).toHaveLength(1);
        expect(p.game.strokes.remove).not.toHaveBeenCalled();
        // and the one that prints q (physical A) rotates without lowering the drawing height
        p.onKey(press('KeyA', 'q'), true);
        expect(p.keys.has('KeyA')).toBe(true);
        expect(p.groundAlt).toBe(0);
    });

    it('finds actions by position on any layout', () => {
        const p = makePhase();
        p.myStrokes.push({ length: 4 });
        p.onKey(press('KeyZ', 'w'), true);
        expect(p.myStrokes).toHaveLength(0);
        // AZERTY digits print '&', 'é', '"' without Shift
        p.onKey(press('Digit2', 'é'), true);
        expect(p.tool).toBe('ground');
        p.onKey(press('Numpad3', '3'), true);
        expect(p.tool).toBe('wall');
        p.onKey(press('KeyE', 'e'), true);
        expect(p.groundAlt).toBe(1.5);
    });

    it('QWERTZ: the key labelled Z (physical Y) undoes, like the drawbar says', () => {
        const p = makePhase();
        p.myStrokes.push({ length: 4 }, { length: 5 });
        p.onKey(press('KeyY', 'z'), true);
        expect(p.myStrokes).toHaveLength(1);
        // Caps Lock / Shift
        p.onKey(press('KeyY', 'Z'), true);
        expect(p.myStrokes).toHaveLength(0);
    });

    it('waits with tool and height changes until the stroke is finished, but not with READY', () => {
        const p = makePhase();
        p.active = {};
        p.onKey(press('Digit2', '2'), true);
        p.onKey(press('KeyE', 'e'), true);
        expect(p.tool).toBe('ribbon');
        expect(p.groundAlt).toBe(0);
        p.onKey(press('Enter', 'Enter'), true);
        expect(p.ready).toBe(true);
    });

    it('ignores auto-repeat for one-shot actions, but keeps raising while E is held', () => {
        const p = makePhase();
        p.onKey(press('Enter', 'Enter'), true);
        for (let i = 0; i < 5; i++) p.onKey(press('Enter', 'Enter', true), true);
        expect(p.ready).toBe(true);
        p.myStrokes.push({ length: 1 }, { length: 2 }, { length: 3 });
        p.onKey(press('KeyZ', 'z'), true);
        for (let i = 0; i < 5; i++) p.onKey(press('KeyZ', 'z', true), true);
        expect(p.myStrokes).toHaveLength(2);
        p.onKey(press('KeyE', 'e'), true);
        p.onKey(press('KeyE', 'e', true), true);
        expect(p.groundAlt).toBe(3);
    });

    it('lets go of held camera keys when the window loses focus or the page is hidden', () => {
        const p = makePhase();
        p.bind();
        p.onKey(press('KeyA', 'a'), true);
        window.dispatchEvent(new Event('blur'));
        expect(p.keys.size).toBe(0);
        p.onKey(press('ArrowLeft', 'ArrowLeft'), true);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(p.keys.size).toBe(0);
        // unbind removes those listeners again
        p.unbind();
        p.onKey(press('KeyA', 'a'), true);
        window.dispatchEvent(new Event('blur'));
        expect(p.keys.has('KeyA')).toBe(true);
    });
});

describe('DrawPhase guides', () => {
    // a ground loop of radius 6 whose ends stay 4 m apart: closed only with the on-screen allowance
    const loop = (n) => {
        const pts = [];
        const end = 2 * Math.PI - 2 * Math.asin(2 / 6);
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * end;
            pts.push(new THREE.Vector3(Math.sin(a) * 6, 0, Math.cos(a) * 6));
        }
        return pts;
    };
    const look = (p, distance) => {
        p.game.gfx.camera.position.set(0, distance, 0.01);
        p.game.gfx.camera.lookAt(0, 0, 0);
        p.game.gfx.camera.updateMatrixWorld();
    };

    it('runs the loop test only when a point is added or the view moves the allowance', () => {
        const p = makePhase({ bots: false });
        p.active = { tool: 'ground', points: loop(40) };
        p.activePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const said = () => p.game.hud.subtitle.mock.lastCall[0];
        isClosedStroke.mockClear();

        look(p, 150);
        for (let i = 0; i < 10; i++) p.updateGuides();
        expect(said()).toBe('release to make a platform');
        expect(isClosedStroke).toHaveBeenCalledTimes(1);

        // up close the 4 m gap is far more than 40 px: the same stroke no longer closes
        look(p, 30);
        p.updateGuides();
        expect(said()).toBe('');
        expect(p.startMarker.scale.x).toBe(1);
        expect(isClosedStroke).toHaveBeenCalledTimes(2);

        // back out: both answers are known for this point count
        look(p, 150);
        p.updateGuides();
        expect(said()).toBe('release to make a platform');
        expect(isClosedStroke).toHaveBeenCalledTimes(2);

        p.active.points.push(p.active.points[0].clone());
        p.updateGuides();
        expect(isClosedStroke).toHaveBeenCalledTimes(3);
        p.unbind();
    });

    it('frees the grid and start marker on dispose', () => {
        const p = makePhase({ bots: false });
        const spies = [p.grid.geometry, p.grid.material, p.startMarker.geometry, p.startMarker.material].map((r) =>
            vi.spyOn(r, 'dispose'),
        );
        p.dispose();
        for (const s of spies) expect(s).toHaveBeenCalled();
        expect(p.game.gfx.scene.children).toHaveLength(0);
    });
});
