import * as THREE from 'three';
import { STROKE, TIMING } from './config.js';
import { inNoDrawZone } from './arena.js';
import { BotArtist } from './botArtist.js';
import { isClosedStroke, loopClosure } from './strokes.js';
import { Rng } from './rng.js';
import { IS_MAC } from './aim.js';

// The 60-second "DRAW THE MAP" phase.

const UP = new THREE.Vector3(0, 1, 0);
const TOOLS = ['ribbon', 'ground', 'wall'];
// how close (in screen pixels) the end of a ground/wall loop must come to its start to close it
const CLOSE_PX = 40;
// Camera keys are physical (like PlayerController) and never also an action: on AZERTY, KeyW prints 'z' (undo)
// and KeyA prints 'q' (lower). Q, E and Z go by the printed letter, so Z undoes where it is labelled (QWERTZ:
// physical KeyY), and fall back to their QWERTY position for layouts that put the letter on a camera key.
// Digits, Tab and Enter go by position (AZERTY prints '&', 'é', '"' on the digit row).
const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const LETTER_ACTIONS = { q: 'lower', e: 'raise', z: 'undo' };
const KEY_ACTIONS = {
    Digit1: 'ribbon',
    Numpad1: 'ribbon',
    Digit2: 'ground',
    Numpad2: 'ground',
    Digit3: 'wall',
    Numpad3: 'wall',
    Tab: 'next',
    KeyQ: 'lower',
    KeyE: 'raise',
    KeyZ: 'undo',
    Enter: 'ready',
    NumpadEnter: 'ready',
};
const _n = new THREE.Vector3();

// The floor under the cursor: the first hit that isn't a wall stroke, and only if it faces up.
// Side faces (bridge/base sides, stroke edges) are not floors - picking them used to put the drawing
// plane at half height or even inside the base.
export function pickGround(hits, minUp = 0.7) {
    for (const h of hits) {
        if (h.object.userData.stroke?.tool === 'wall') continue;
        if (!h.face) return null;
        return _n.copy(h.face.normal).transformDirection(h.object.matrixWorld).y >= minUp ? h : null;
    }
    return null;
}

function createGrid() {
    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
            center: { value: new THREE.Vector3() },
            axisA: { value: new THREE.Vector3(1, 0, 0) },
            axisB: { value: new THREE.Vector3(0, 0, 1) },
            color: { value: new THREE.Color(0xffffff) },
            opacity: { value: 0.0 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vWorld;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                vWorld = w.xyz;
                gl_Position = projectionMatrix * viewMatrix * w;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 center;
            uniform vec3 axisA;
            uniform vec3 axisB;
            uniform vec3 color;
            uniform float opacity;
            varying vec3 vWorld;
            void main() {
                vec2 p = vec2(dot(vWorld, axisA), dot(vWorld, axisB)) / 2.0;
                vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
                float line = 1.0 - min(min(g.x, g.y), 1.0);
                float d = length(vWorld - center);
                float fade = 1.0 - smoothstep(3.0, 13.0, d);
                float a = (line * 0.55 + 0.05) * fade * opacity;
                if (a < 0.003) discard;
                gl_FragColor = vec4(color, a);
            }
        `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat);
    mesh.renderOrder = 5;
    return mesh;
}

export class DrawPhase {
    constructor(game, { duration = TIMING.draw, attract = false, bots = true, spin = 0.05, canReady = null } = {}) {
        this.game = game;
        this.attract = attract;
        this.spin = spin;
        this.canReady = canReady;
        this.time = duration;
        this.tool = 'ribbon';
        this.ink = STROKE.ink;
        this.groundAlt = 0;
        this.ready = false;
        this.done = false;
        this.active = null;
        this.myStrokes = [];
        this.rebuildTimer = 0;
        this.keys = new Set();
        this.mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
        this.lastMouse = { x: 0, y: 0 };
        this.scribble = 0;
        this.raycaster = new THREE.Raycaster();
        this.ndc = new THREE.Vector2();

        const v = game.arena.view;
        this.orbit = { target: v.target.clone(), azimuth: v.azimuth, elevation: v.elevation, distance: v.distance };
        this.orbitGoal = { ...this.orbit, target: v.target.clone() };
        if (attract) this.orbitGoal.distance *= 1.05;
        this.dragOrbit = null;

        const rng = new Rng();
        const me = game.me;
        const drawers = (bots ? game.roster : []).filter((c) => c !== me);
        const maxShapes = THREE.MathUtils.clamp(Math.round(42 / Math.max(1, drawers.length)), 3, 7);
        const teamCounts = new Map();
        this.artists = drawers.map((who, i) => {
            if (!teamCounts.has(who.team)) teamCounts.set(who.team, new Map());
            return new BotArtist({
                who,
                strokes: game.strokes,
                arena: game.arena,
                mode: game.mode,
                hud: game.hud,
                rng: new Rng(Math.floor(rng.next() * 1e9) + i),
                startDelay: attract ? i * 0.4 : 0.6,
                maxShapes,
                teamCounts: teamCounts.get(who.team),
            });
        });

        if (!attract) {
            this.grid = createGrid();
            game.gfx.scene.add(this.grid);
            this.startMarker = new THREE.Mesh(
                new THREE.TorusGeometry(0.9, 0.12, 8, 32),
                new THREE.MeshBasicMaterial({ color: me.color, transparent: true, opacity: 0.9, depthTest: false }),
            );
            this.startMarker.visible = false;
            this.startMarker.renderOrder = 6;
            game.gfx.scene.add(this.startMarker);
            this.selfCursor = game.hud.createCursor('YOU', me.color, true);
            game.hud.showDrawBar({
                onTool: (t) => this.setTool(t),
                onUndo: () => this.undo(),
                onReady: () => this.toggleReady(),
            });
            document.body.classList.add('drawing');
            this.bind();
            game.hud.caption('DRAW', 'THE MAP', 2.4);
        }
    }

    // ---------- input ----------
    bind() {
        const c = this.game.gfx.renderer.domElement;
        this.handlers = {
            pointerdown: (e) => this.onPointerDown(e),
            pointermove: (e) => this.onPointerMove(e),
            pointerleave: () => {
                this.mouse.inside = false;
            },
            wheel: (e) => {
                e.preventDefault();
                this.orbitGoal.distance = THREE.MathUtils.clamp(
                    this.orbitGoal.distance * Math.exp(e.deltaY * 0.0012),
                    18,
                    190,
                );
            },
            // a stroke whose release never arrives (cancel, lost capture) must still end
            pointercancel: () => this.endStroke(),
            lostpointercapture: () => this.endStroke(),
        };
        for (const [k, fn] of Object.entries(this.handlers)) c.addEventListener(k, fn, { passive: k !== 'wheel' });
        // page-wide and non-passive, so right-drag / Ctrl-drag / two-finger clicks never open a menu
        this.contextMenu = (e) => e.preventDefault();
        window.addEventListener('contextmenu', this.contextMenu, { capture: true });
        this.keyDown = (e) => this.onKey(e, true);
        this.keyUp = (e) => this.onKey(e, false);
        this.pointerUp = (e) => this.onPointerUp(e);
        window.addEventListener('keydown', this.keyDown);
        window.addEventListener('keyup', this.keyUp);
        window.addEventListener('pointerup', this.pointerUp);
        // a key let go while the page is in the background never sends its keyup
        this.releaseKeys = () => this.keys.clear();
        window.addEventListener('blur', this.releaseKeys);
        document.addEventListener('visibilitychange', this.releaseKeys);
    }

    unbind() {
        if (!this.handlers) return;
        const c = this.game.gfx.renderer.domElement;
        for (const [k, fn] of Object.entries(this.handlers)) c.removeEventListener(k, fn);
        window.removeEventListener('keydown', this.keyDown);
        window.removeEventListener('keyup', this.keyUp);
        window.removeEventListener('pointerup', this.pointerUp);
        window.removeEventListener('contextmenu', this.contextMenu, { capture: true });
        window.removeEventListener('blur', this.releaseKeys);
        document.removeEventListener('visibilitychange', this.releaseKeys);
        this.handlers = null;
    }

    onKey(e, down) {
        const c = e.code;
        if (CAMERA_KEYS.has(c)) {
            if (down) this.keys.add(c);
            else this.keys.delete(c);
        }
        if (!down) return;
        if (c === 'Tab') e.preventDefault();
        const act = CAMERA_KEYS.has(c) ? null : (LETTER_ACTIONS[e.key.toLowerCase()] ?? KEY_ACTIONS[c]);
        if (!act) return;
        // tool and height changes wait until the current stroke is finished
        if (this.active && act !== 'undo' && act !== 'ready') return;
        // one press, one action: auto-repeat only keeps the height moving while Q/E is held
        if (e.repeat && act !== 'lower' && act !== 'raise') return;
        if (act === 'next') this.setTool(TOOLS[(TOOLS.indexOf(this.tool) + 1) % TOOLS.length]);
        else if (act === 'undo') this.undo();
        else if (act === 'ready') this.toggleReady();
        else if (act === 'lower' || act === 'raise') {
            // height offset for ground/wall strokes, on top of whatever surface is under the cursor
            this.groundAlt = THREE.MathUtils.clamp(this.groundAlt + (act === 'raise' ? 1.5 : -1.5), -12, 24);
            this.hover = null;
        } else this.setTool(act);
    }

    setMouse(e) {
        const r = this.game.gfx.renderer.domElement.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left;
        this.mouse.y = e.clientY - r.top;
        this.mouse.inside = true;
        this.ndc.set((this.mouse.x / r.width) * 2 - 1, -(this.mouse.y / r.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.game.gfx.camera);
    }

    onPointerDown(e) {
        this.game.sfx.unlock();
        this.setMouse(e);
        // right-drag (or Ctrl-drag, the Mac right click) orbits the view
        const ctrl = IS_MAC && e.ctrlKey && e.button === 0;
        if (e.button === 2 || ctrl) {
            this.dragOrbit = { x: e.clientX, y: e.clientY, ctrl };
            return;
        }
        if (e.button !== 0 || this.done) return;
        this.dragOrbit = null;
        // a previous stroke whose release got lost is finished first
        if (this.active) this.endStroke();
        if (this.ink < 1) {
            this.game.hud.caption('OUT OF', 'INK', 1.2);
            return;
        }
        const plane = this.planeUnderMouse();
        if (!plane) return;
        const p = this.projectMouse(plane.plane);
        if (!p) return;
        if (!this.inBounds(p)) {
            this.game.hud.caption('OUT OF', 'BOUNDS', 1.0);
            return;
        }
        if (inNoDrawZone(this.game.arena, p)) {
            this.game.hud.caption('NO DRAWING', 'ON SPAWNS', 1.0);
            return;
        }
        // keep receiving moves while the cursor crosses the toolbar
        try {
            this.game.gfx.renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
            // pointer capture is best-effort
        }
        const me = this.game.me;
        this.active = this.game.strokes.create({
            team: me.team,
            owner: me,
            tool: this.tool,
            planeNormal: plane.plane.normal,
            planeY: plane.y,
        });
        this.activePlane = plane.plane;
        this.active.addPoint(p);
        this.startMarker.position.copy(p);
        this.startMarker.position.y += STROKE.groundLift;
        this.startMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.plane.normal);
        this.startMarker.visible = this.tool !== 'ribbon';
        this.game.sfx.pop();
    }

    onPointerMove(e) {
        const o = this.dragOrbit;
        // a release we never saw (chorded buttons, focus change): stop orbiting when the button is up
        if (o && !(e.buttons & (o.ctrl ? 1 : 2))) this.dragOrbit = null;
        if (this.dragOrbit) {
            this.orbitGoal.azimuth -= (e.clientX - o.x) * 0.006;
            this.orbitGoal.elevation = THREE.MathUtils.clamp(
                this.orbitGoal.elevation + (e.clientY - o.y) * 0.005,
                0.08,
                1.45,
            );
            o.x = e.clientX;
            o.y = e.clientY;
        }
        this.setMouse(e);
        if (!this.active) return;
        if (!(e.buttons & 1)) {
            this.endStroke();
            return;
        }
        const p = this.projectMouse(this.activePlane);
        if (!p) return;
        // leaving the arena ends the stroke (re-entering elsewhere would draw a chord along the edge)
        if (!this.inBounds(p)) {
            this.endStroke();
            this.game.hud.caption('EDGE OF', 'THE ARENA', 1.0);
            return;
        }
        if (inNoDrawZone(this.game.arena, p)) {
            this.endStroke();
            this.game.hud.caption('NO DRAWING', 'ON SPAWNS', 1.0);
            return;
        }
        const used = this.active.addPoint(p);
        if (used > 0) {
            this.ink -= used;
            this.dirty = true;
            this.scribble = Math.min(1, this.scribble + used * 0.25);
        }
        if (this.ink <= 0 || this.active.length >= STROKE.maxLength) this.endStroke();
    }

    onPointerUp(e) {
        if (this.dragOrbit && (e.button === 2 || this.dragOrbit.ctrl || !e.buttons)) {
            this.dragOrbit = null;
            return;
        }
        if (e.button === 0 && this.active) {
            // keep the exact release point, so a loop ends where the player let go
            const p = this.projectMouse(this.activePlane);
            if (p && this.inBounds(p) && !inNoDrawZone(this.game.arena, p)) {
                const used = this.active.addPoint(p, 0.05);
                this.ink -= used;
            }
            this.endStroke();
        }
    }

    // Loop-closing tolerance: if the loop's ends are within CLOSE_PX on screen, the metres between
    // them (measured on screen, so depth doesn't shrink the allowance); otherwise none.
    closeAllowance(points, c = loopClosure(points)) {
        if (!c) return 0;
        const cam = this.game.gfx.camera;
        const el = this.game.gfx.renderer.domElement;
        const a = points[c.i].clone().project(cam);
        const b = points[c.j].clone().project(cam);
        const px = Math.hypot((a.x - b.x) * el.clientWidth, (a.y - b.y) * el.clientHeight) / 2;
        return px <= CLOSE_PX ? c.gap + 1e-3 : 0;
    }

    endStroke() {
        const s = this.active;
        this.active = null;
        this.startMarker.visible = false;
        if (!s) return;
        if (s.points.length < 3 || s.length < 1) {
            this.ink += s.length;
            this.game.strokes.remove(s);
            return;
        }
        s.rebuild(true, s.tool === 'ribbon' ? 0 : this.closeAllowance(s.points));
        this.myStrokes.push(s);
        if (s.closed && s.tool !== 'ribbon') this.game.sfx.pop();
    }

    undo() {
        if (this.active) return;
        const s = this.myStrokes.pop();
        if (!s) return;
        this.ink = Math.min(STROKE.ink, this.ink + s.length);
        this.game.strokes.remove(s);
        this.game.sfx.click();
    }

    setTool(t) {
        if (this.tool === t) return;
        this.tool = t;
        this.hover = null;
        this.game.sfx.click();
    }

    toggleReady() {
        if (!this.ready && this.canReady && !this.canReady()) {
            this.game.hud.caption('NOT YET', 'FINISH THE LIST', 1.4);
            this.game.sfx.click();
            return;
        }
        // READY shortens the clock to 3 s; cancelling gives the remaining time back
        if (!this.ready) this.preReadyTime = this.time;
        this.ready = !this.ready;
        if (!this.ready && this.preReadyTime !== undefined) {
            this.time = Math.max(this.time, this.preReadyTime - (this.preReadyElapsed ?? 0));
        }
        this.preReadyElapsed = 0;
        this.game.sfx.click();
        if (this.ready) this.game.hud.caption('READY', '', 1.0);
    }

    // ---------- drawing planes ----------
    planeUnderMouse() {
        const targets = [...this.game.arena.colliders, ...this.game.strokes.meshes()];
        const hits = this.mouse.inside ? this.raycaster.intersectObjects(targets, false) : [];
        if (this.tool === 'ribbon') {
            const hit = hits[0];
            const cam = this.game.gfx.camera;
            const n = new THREE.Vector3().subVectors(cam.position, this.orbit.target);
            n.y = 0;
            if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
            n.normalize();
            let anchor = hit?.point;
            if (!anchor) {
                const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.orbit.target);
                anchor = this.raycaster.ray.intersectPlane(pl, new THREE.Vector3());
            }
            if (!anchor) return null;
            return { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, anchor), y: anchor.y, anchor };
        }
        // ground and wall strokes draw on a horizontal plane: the floor under the cursor (empty space
        // counts as y = 0, where every arena top sits) plus the Q/E offset
        const hit = pickGround(hits);
        const y = (hit ? hit.point.y : 0) + this.groundAlt;
        const plane = new THREE.Plane(UP.clone(), -y);
        const anchor = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? hit?.point.clone();
        if (!anchor) return null;
        return { plane, y, anchor };
    }

    projectMouse(plane) {
        const ray = this.raycaster.ray;
        // nearly parallel rays would fling the point far away
        if (Math.abs(plane.normal.dot(ray.direction)) < 0.08) return null;
        const p = ray.intersectPlane(plane, new THREE.Vector3());
        if (!p) return null;
        if (p.distanceTo(this.game.gfx.camera.position) > 400) return null;
        return p;
    }

    inBounds(p) {
        return this.game.arena.bounds.containsPoint(p);
    }

    // ---------- per frame ----------
    updateCamera(dt) {
        const g = this.orbitGoal;
        const rot = 1.6 * dt;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) g.azimuth -= rot;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) g.azimuth += rot;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) g.elevation = Math.min(1.45, g.elevation + rot * 0.6);
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) g.elevation = Math.max(0.08, g.elevation - rot * 0.6);
        if (this.attract) g.azimuth += dt * this.spin;
        const o = this.orbit;
        const k = 1 - Math.exp(-dt * 8);
        o.azimuth += (g.azimuth - o.azimuth) * k;
        o.elevation += (g.elevation - o.elevation) * k;
        o.distance += (g.distance - o.distance) * k;
        const cam = this.game.gfx.camera;
        const ce = Math.cos(o.elevation);
        cam.position.set(
            o.target.x + Math.sin(o.azimuth) * ce * o.distance,
            o.target.y + Math.sin(o.elevation) * o.distance,
            o.target.z + Math.cos(o.azimuth) * ce * o.distance,
        );
        cam.lookAt(o.target);
        if (cam.fov !== 50) {
            cam.fov = 50;
            cam.updateProjectionMatrix();
        }
    }

    update(dt) {
        if (this.done) return;
        this.updateCamera(dt);
        const cam = this.game.gfx.camera;
        cam.updateMatrixWorld();
        // the camera may have moved since the last mouse event
        this.raycaster.setFromCamera(this.ndc, cam);
        const w = innerWidth;
        const h = innerHeight;
        for (const a of this.artists) a.update(dt, cam, w, h);

        if (this.attract) return;

        this.time -= dt;
        if (this.ready) this.preReadyElapsed = (this.preReadyElapsed ?? 0) + dt;
        if (this.ready && this.time > 3) this.time = 3;

        this.rebuildTimer -= dt;
        if (this.active && this.dirty && this.rebuildTimer <= 0) {
            this.active.rebuild(false);
            this.dirty = false;
            this.rebuildTimer = 0.035;
        }

        this.updateGuides();
        this.selfCursor.set(this.mouse.x, this.mouse.y, this.mouse.inside);
        this.scribble = Math.max(0, this.scribble - dt * 4);
        this.game.sfx.setScribble(this.active ? this.scribble : 0);

        const me = this.game.me;
        const timed = Number.isFinite(this.time);
        const t = timed ? Math.max(0, Math.ceil(this.time)) : 0;
        this.game.hud.setTop({
            header: `${this.game.mode.label} · DRAW THE MAP`,
            timer: timed ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '∞',
            hot: this.time <= 5.5,
        });
        this.game.hud.updateDrawBar({
            tool: this.tool,
            ink: this.ink / STROKE.ink,
            ready: this.ready,
            color: me.color,
            lift: this.tool === 'ribbon' ? null : this.groundAlt,
        });
        if (this.time <= 5.5 && Math.ceil(this.time) !== this.lastBeep) {
            this.lastBeep = Math.ceil(this.time);
            this.game.sfx.beep(this.lastBeep <= 0);
        }
        if (this.time <= 0) this.finish();
    }

    updateGuides() {
        const grid = this.grid;
        const u = grid.material.uniforms;
        let plane = null;
        let anchor = null;
        if (this.active) {
            plane = this.activePlane;
            anchor = this.active.points[this.active.points.length - 1];
        } else if (this.mouse.inside) {
            // hover raycasts hit every stroke mesh, so only refresh them a few times per second
            this.hoverTimer = (this.hoverTimer ?? 0) - 1;
            if (this.hoverTimer <= 0 || !this.hover) {
                this.hover = this.planeUnderMouse();
                this.hoverTimer = 4;
            }
            if (this.hover) {
                plane = this.hover.plane;
                anchor = this.projectMouse(plane) ?? this.hover.anchor;
            }
        }
        if (!plane || !anchor) {
            u.opacity.value = Math.max(0, u.opacity.value - 0.1);
            return;
        }
        u.opacity.value = Math.min(this.active ? 0.9 : 0.6, u.opacity.value + 0.1);
        grid.position.copy(anchor);
        grid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
        u.center.value.copy(anchor);
        const a = new THREE.Vector3(1, 0, 0).applyQuaternion(grid.quaternion);
        const b = new THREE.Vector3(0, 1, 0).applyQuaternion(grid.quaternion);
        u.axisA.value.copy(a);
        u.axisB.value.copy(b);

        if (this.active && this.active.tool !== 'ribbon') {
            const pts = this.active.points;
            // the stroke only changes when a point is added: keep its closure and loop tests until then.
            // The allowance follows the view, so it is measured every frame (two projections); it is
            // either 0 or the closing gap, so at most two loop tests per point count.
            let cc = this.closeCache;
            if (cc?.stroke !== this.active || cc.n !== pts.length) {
                cc = { stroke: this.active, n: pts.length, closure: loopClosure(pts), closed: new Map() };
                this.closeCache = cc;
            }
            const allowance = this.closeAllowance(pts, cc.closure);
            let closable = cc.closed.get(allowance);
            if (closable === undefined) cc.closed.set(allowance, (closable = isClosedStroke(pts, allowance)));
            const s = closable ? 1.5 + Math.sin(performance.now() * 0.02) * 0.2 : 1;
            this.startMarker.scale.setScalar(s);
            const msg = this.active.tool === 'ground' ? 'release to make a platform' : 'release to close the ring';
            this.game.hud.subtitle(closable ? msg : '');
        } else {
            this.game.hud.subtitle('');
        }
    }

    // End the phase: complete everyone's strokes and clean up.
    finish() {
        if (this.done) return;
        if (this.active) this.endStroke();
        for (const a of this.artists) a.finishAll();
        this.dispose();
        this.done = true;
    }

    dispose() {
        this.unbind();
        for (const a of this.artists) a.dispose();
        this.artists = [];
        if (this.grid) {
            this.game.gfx.scene.remove(this.grid, this.startMarker);
            this.grid.geometry.dispose();
            this.grid.material.dispose();
            this.startMarker.geometry.dispose();
            this.startMarker.material.dispose();
            this.selfCursor.remove();
            this.game.hud.hideDrawBar();
            this.game.hud.subtitle('');
            this.game.sfx.setScribble(0);
        }
        document.body.classList.remove('drawing');
    }
}
