import * as THREE from 'three';
import { AIM, JET, PHYS, WEAPONS } from './config.js';
import { createJet, jetStep } from './jet.js';
import { IDLE_AIM, aimPress, aimReducer, aimRelease, mouseAction } from './aim.js';

// First-person controls, weapons and the on-screen arm + gun.

const BASE_FOV = 75;
// where each gun sits when fully aimed (centred under the crosshair)
const ADS_POSE = {
    rifle: { pos: new THREE.Vector3(0, -0.095, -0.34), rot: new THREE.Euler(0, 0, 0) },
    launcher: { pos: new THREE.Vector3(0, -0.13, -0.4), rot: new THREE.Euler(0.03, 0, 0) },
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
}

class ViewModel {
    constructor(scene, color) {
        const black = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.42, metalness: 0.1 });
        const white = new THREE.MeshStandardMaterial({ color: 0xeeeeec, roughness: 0.6 });
        const skin = new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.75 });
        const band = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
        const glow = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color).multiplyScalar(5),
            toneMapped: false,
        });

        this.root = new THREE.Group();
        this.pivot = new THREE.Group();
        this.root.add(this.pivot);
        scene.add(this.root);

        // rifle (points down -Z)
        const rifle = new THREE.Group();
        rifle.add(
            box(0.075, 0.12, 0.52, black, 0, 0, -0.1),
            box(0.079, 0.05, 0.3, white, 0, -0.005, -0.14),
            box(0.05, 0.065, 0.3, black, 0, 0.012, -0.5),
            box(0.046, 0.045, 0.2, black, 0, 0.083, -0.06),
            box(0.06, 0.09, 0.16, black, 0, -0.01, 0.22),
        );
        const grip = box(0.05, 0.13, 0.065, black, 0, -0.105, 0.05);
        grip.rotation.x = 0.35;
        rifle.add(grip);
        this.rifle = rifle;

        // plasma lobber
        const lob = new THREE.Group();
        lob.add(
            box(0.12, 0.14, 0.42, black, 0, 0, -0.08),
            box(0.124, 0.04, 0.22, white, 0, -0.035, -0.08),
        );
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 12), glow);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(0, 0.085, -0.1);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.2, 16), black);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.01, -0.36);
        const lgrip = box(0.055, 0.13, 0.07, black, 0, -0.11, 0.06);
        lgrip.rotation.x = 0.35;
        lob.add(tube, barrel, lgrip);
        lob.visible = false;
        this.launcher = lob;

        // arm: glove on the grip, sleeve running down out of frame, team-coloured wristband
        const arm = new THREE.Group();
        const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.62, 6, 16), skin);
        fore.position.set(0, -0.36, 0);
        const wrist = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.026, 10, 28), band);
        wrist.rotation.x = Math.PI / 2;
        wrist.position.set(0, -0.085, 0);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), white);
        hand.scale.set(0.95, 1.1, 1.2);
        const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 8), white);
        thumb.position.set(-0.04, 0.04, -0.035);
        thumb.rotation.set(0.6, 0, 0.4);
        arm.add(fore, wrist, hand, thumb);
        arm.position.set(0, -0.11, 0.05);
        // forearm runs from the grip down toward the bottom of the screen
        arm.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, -1, 0),
            new THREE.Vector3(0.05, -0.92, 0.38).normalize(),
        );
        this.arm = arm;

        this.pivot.add(rifle, lob, arm);
        this.pivot.scale.setScalar(0.7);
        this.pivot.position.set(0.2, -0.14, -0.43);
        this.pivot.rotation.set(0.13, 0.22, 0.1);
        this.basePos = this.pivot.position.clone();
        this.baseRot = this.pivot.rotation.clone();

        this.muzzles = {
            rifle: new THREE.Vector3(0, 0.012, -0.66),
            launcher: new THREE.Vector3(0, 0.01, -0.47),
        };
        this._dir = new THREE.Vector3();
        this.phase = 0;
        this.recoil = 0;
        this.sway = new THREE.Vector2();
        this.drop = 0;
        this.land = 0;
    }

    setWeapon(id) {
        this.rifle.visible = id === 'rifle';
        this.launcher.visible = id === 'launcher';
    }

    update(dt, s) {
        const run = s.onGround ? Math.min(1, s.speed / 9) : 0;
        this.phase += dt * (6 + s.speed * 0.9) * (run > 0.05 ? 1 : 0.3);
        this.recoil *= Math.exp(-dt * 16);
        this.sway.multiplyScalar(Math.exp(-dt * 9));
        this.land *= Math.exp(-dt * 10);
        const reload = s.reload > 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
        const targetDrop = s.switching ? 1 : 0;
        this.drop += (targetDrop - this.drop) * (1 - Math.exp(-dt * 18));

        const ads = s.ads || 0;
        const pose = ADS_POSE[s.weapon] || ADS_POSE.rifle;
        // aiming steadies the gun: less bob and sway
        const steady = 1 - 0.85 * ads;
        const p = this.pivot.position.copy(this.basePos).lerp(pose.pos, ads);
        p.x += (Math.sin(this.phase) * 0.011 * run + this.sway.x) * steady;
        p.y +=
            (-Math.abs(Math.cos(this.phase)) * 0.013 * run + this.sway.y) * steady - this.drop * 0.3 - this.land * 0.04;
        p.y += Math.sin(performance.now() * 0.0016) * 0.003 * steady;
        p.z += this.recoil * 0.07;
        const lerp = (a, b) => a + (b - a) * ads;
        this.pivot.rotation.set(
            lerp(this.baseRot.x, pose.rot.x) + this.recoil * 0.09 - reload * 0.5 - this.drop * 0.4,
            lerp(this.baseRot.y, pose.rot.y) + this.sway.x * 1.5 * steady - reload * 0.25,
            lerp(this.baseRot.z, pose.rot.z) - reload * 0.3,
        );
    }

    // World position that lines up with the drawn muzzle, as seen from the main camera.
    muzzleWorld(id, viewCamera, camera, out) {
        out.copy(this.muzzles[id]);
        this.pivot.updateMatrixWorld(true);
        (id === 'rifle' ? this.rifle : this.launcher).localToWorld(out);
        out.project(viewCamera);
        out.z = 0.5;
        out.unproject(camera);
        const dir = this._dir.subVectors(out, camera.position).normalize();
        return out.copy(camera.position).addScaledVector(dir, 0.85);
    }

    dispose(scene) {
        scene.remove(this.root);
        // every geometry and material under the root was made for this viewmodel alone
        this.root.traverse((o) => {
            if (o.isMesh) {
                o.geometry.dispose();
                o.material.dispose();
            }
        });
    }
}

export class PlayerController {
    constructor(fight, fighter) {
        this.fight = fight;
        this.f = fighter;
        this.game = fight.game;
        this.keys = new Set();
        this.fire = false;
        // presses are latched until the next weapon update so a quick tap (trackpad) is never lost
        this.fireQueued = false;
        this.jet = createJet();
        // progress counters the tutorial reads
        this.stats = { doubleJumps: 0, glide: 0, hits: { rifle: 0, launcher: 0, aimed: 0 } };
        // aim down sights: `aimState` is the input (see aim.js), `ads` the 0..1 blend for zoom/pose
        this.aimState = { ...IDLE_AIM };
        this.aimSawBit = false;
        // last real right-button press/release, so the contextmenu fallback can tell it's redundant
        this.lastAimEvent = -1e9;
        this.ads = 0;
        this.scoped = false;
        this.locked = false;
        // free-mouse aiming (no pointer lock): where the hidden cursor is, for edge turning
        this.cursor = { x: 0.5, y: 0.5, inside: false };
        this.wheel = { acc: 0, last: 0, armed: true };
        this.coyote = 0;
        this.jumpQueued = false;
        this.shake = 0;
        this.fov = BASE_FOV;
        this.vm = new ViewModel(this.game.gfx.viewScene, fighter.color);
        this.weapon = 'rifle';
        this.ammo = { rifle: WEAPONS.rifle.mag, launcher: WEAPONS.launcher.mag };
        this.cooldown = 0;
        this.reloading = 0;
        this.switching = 0;
        this._v = new THREE.Vector3();
        this._m = new THREE.Vector3();
        this.bind();
    }

    get sensitivity() {
        return 0.0022 * (this.game.settings.sensitivity || 1);
    }

    get aimMode() {
        return this.game.settings.aimMode === 'toggle' ? 'toggle' : 'hold';
    }

    get aiming() {
        return this.aimState.aiming;
    }

    set aiming(v) {
        this.aimState = { ...IDLE_AIM, aiming: v };
    }

    // Look is allowed from the countdown on; movement and firing only once the match is live.
    canLook() {
        const s = this.fight.state;
        return this.f.alive && !this.fight.paused && (s === 'live' || s === 'countdown');
    }

    look(dx, dy) {
        // zoomed views turn slower so the crosshair keeps the same feel
        const k = this.sensitivity * (this.fov / BASE_FOV);
        this.f.yaw -= dx * k;
        this.f.pitch = THREE.MathUtils.clamp(this.f.pitch - dy * k, -1.5, 1.5);
        this.vm.sway.x = THREE.MathUtils.clamp(this.vm.sway.x - dx * 0.00006, -0.03, 0.03);
        this.vm.sway.y = THREE.MathUtils.clamp(this.vm.sway.y + dy * 0.00006, -0.03, 0.03);
    }

    releaseInputs() {
        this.fire = false;
        this.fireQueued = false;
        this.aimState = { ...IDLE_AIM };
        this.aimSawBit = false;
        this.jumpQueued = false;
    }

    pressAim(src, e) {
        // armed from the press itself, so a release we never see is still caught by the next move
        this.aimSawBit = src === 'rmb' && (e.buttons & 2) !== 0;
        this.lastAimEvent = performance.now();
        // event timestamps share one clock per engine, so tap detection survives slow frames
        this.aimState = aimPress(this.aimState, { src, mode: this.aimMode, t: e.timeStamp });
    }

    releaseAim(t) {
        this.aimState = aimRelease(this.aimState, { t });
    }

    // Tutorial bookkeeping: hits per weapon, and rifle hits made while aiming.
    countHit(weapon) {
        this.stats.hits[weapon] = (this.stats.hits[weapon] || 0) + 1;
        if (weapon === 'rifle' && this.ads >= AIM.hitAds) this.stats.hits.aimed++;
    }

    bind() {
        const canvas = this.game.gfx.renderer.domElement;
        // Without pointer lock only input aimed at the canvas counts (not clicks on HUD panels).
        const accepts = (e) => this.locked || e.target === canvas;
        this.h = {
            mousemove: (e) => {
                // a lost mouseup (menu, focus change) would leave hold-to-aim stuck: watch the button bits
                if (this.aimState.src === 'rmb') {
                    if (e.buttons & 2) this.aimSawBit = true;
                    else if (this.aimSawBit) this.releaseAim(Infinity);
                }
                if (this.locked) {
                    if (this.canLook()) this.look(e.movementX || 0, e.movementY || 0);
                    return;
                }
                // free aim: use cursor-position deltas (movementX is 0 for unlocked moves in some engines)
                const c = this.cursor;
                const r = canvas.getBoundingClientRect();
                const inside = e.target === canvas;
                const dx = c.inside && c.px !== undefined ? e.clientX - c.px : 0;
                const dy = c.inside && c.py !== undefined ? e.clientY - c.py : 0;
                c.px = e.clientX;
                c.py = e.clientY;
                c.x = (e.clientX - r.left) / r.width;
                c.y = (e.clientY - r.top) / r.height;
                c.inside = inside;
                if (inside && this.canLook()) this.look(dx, dy);
            },
            mousedown: (e) => {
                if (!accepts(e)) return;
                const act = mouseAction(e);
                if (act === 'fire') {
                    // only firing asks for pointer lock; a refused right-click lock would stick for the session
                    const s = this.fight.state;
                    if (!this.locked && !this.fight.paused && (s === 'live' || s === 'countdown')) this.fight.tryLock();
                    this.fire = true;
                    // only latch taps once the match is live, so a countdown click can't fire later
                    if (this.fight.live) this.fireQueued = true;
                } else if (act === 'aim') {
                    this.pressAim(e.button === 0 ? 'ctrl' : 'rmb', e);
                }
            },
            mouseup: (e) => {
                // a Ctrl+click never set fire, so clearing it on every left release is always safe
                if (e.button === 0) this.fire = false;
                if (e.button === 2) {
                    this.releaseAim(e.timeStamp);
                    this.lastAimEvent = performance.now();
                }
            },
            // movement uses physical key codes so WASD works on any keyboard layout
            keydown: (e) => {
                const c = e.code;
                if (c === 'Space') {
                    e.preventDefault();
                    if (!this.keys.has(c)) this.jumpQueued = true;
                }
                this.keys.add(c);
                if (e.repeat) return;
                if (c === 'Digit1') this.switchTo('rifle');
                if (c === 'Digit2') this.switchTo('launcher');
                if (c === 'KeyQ') this.switchTo(this.weapon === 'rifle' ? 'launcher' : 'rifle');
                if (c === 'KeyR') this.startReload();
                // with pointer lock the browser turns Esc into an unlock (-> pause); without it, pause here
                if ((c === 'Escape' || c === 'KeyP') && !this.locked) this.fight.pause();
            },
            keyup: (e) => this.keys.delete(e.code),
            wheel: (e) => {
                // a two-finger trackpad click often comes with a little scroll: never swap while aiming
                if (this.aiming || !accepts(e) || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                // one deliberate scroll gesture = one weapon swap (trackpads stream many small events)
                const w = this.wheel;
                const now = e.timeStamp;
                if (now - w.last > 300) {
                    w.armed = true;
                    w.acc = 0;
                }
                w.last = now;
                if (!w.armed) return;
                w.acc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
                if (Math.abs(w.acc) >= 50) {
                    w.armed = false;
                    this.switchTo(this.weapon === 'rifle' ? 'launcher' : 'rifle');
                }
            },
            // blocked page-wide (WebKit can target it away from the canvas, opening a menu that drops
            // the pointer lock); an engine that reports only this event still gets an aim toggle.
            // It fires on press (macOS) or after release (Windows), so compare with both.
            contextmenu: (e) => {
                e.preventDefault();
                if (performance.now() - this.lastAimEvent > 300 && this.canLook()) {
                    this.aiming = aimReducer(this.aiming, 'press', 'toggle');
                }
            },
            blur: () => {
                this.keys.clear();
                this.releaseInputs();
            },
        };
        this.onLeave = () => {
            this.cursor.inside = false;
            this.cursor.px = undefined;
            this.cursor.py = undefined;
        };
        for (const [k, fn] of Object.entries(this.h)) {
            window.addEventListener(k, fn, k === 'wheel' ? { passive: true } : { capture: k === 'contextmenu' });
        }
        canvas.addEventListener('mouseleave', this.onLeave);
    }

    unbind() {
        const canvas = this.game.gfx.renderer.domElement;
        for (const [k, fn] of Object.entries(this.h)) {
            window.removeEventListener(k, fn, { capture: k === 'contextmenu' });
        }
        canvas.removeEventListener('mouseleave', this.onLeave);
    }

    // Free-mouse mode: the cursor eventually hits the window edge, so keep turning while it rests there.
    edgeTurn(dt) {
        if (this.locked || !this.cursor.inside || !this.canLook()) return;
        const m = 0.09;
        const rate = 2.4 * (this.game.settings.sensitivity || 1) * dt * (this.fov / BASE_FOV);
        const { x, y } = this.cursor;
        if (x < m) this.f.yaw += rate * (1 - x / m);
        else if (x > 1 - m) this.f.yaw -= rate * (1 - (1 - x) / m);
        if (y < m) this.f.pitch += rate * 0.6 * (1 - y / m);
        else if (y > 1 - m) this.f.pitch -= rate * 0.6 * (1 - (1 - y) / m);
        this.f.pitch = THREE.MathUtils.clamp(this.f.pitch, -1.5, 1.5);
    }

    switchTo(id) {
        if (id === this.weapon || !this.f.alive) return;
        this.weapon = id;
        this.switching = 0.32;
        this.reloading = 0;
        this.game.sfx.click();
    }

    startReload() {
        const W = WEAPONS[this.weapon];
        if (this.reloading > 0 || this.ammo[this.weapon] >= W.mag || this.switching > 0) return;
        this.reloading = W.reload;
        this.game.sfx.reload();
    }

    resetForSpawn() {
        this.ammo = { rifle: WEAPONS.rifle.mag, launcher: WEAPONS.launcher.mag };
        this.reloading = 0;
        this.switching = 0;
        this.cooldown = 0.2;
        this.jet = createJet();
        this.releaseInputs();
    }

    updateMovement(dt) {
        const f = this.f;
        const body = f.body;
        const k = this.keys;
        const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
        const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        const sy = Math.sin(f.yaw);
        const cy = Math.cos(f.yaw);
        const wish = this._v.set(-sy * fwd + cy * side, 0, -cy * fwd - sy * side);
        if (wish.lengthSq() > 0) wish.normalize();
        const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && fwd > 0 && !this.aiming && this.ads < 0.2;
        const speed = (sprint ? PHYS.sprint : PHYS.walk) * (1 - (1 - AIM.move) * this.ads);

        const wasGround = body.onGround;
        if (body.onGround) {
            this.coyote = 0.12;
            f.jumpsLeft = 1;
            const tx = wish.x * speed - body.vel.x;
            const tz = wish.z * speed - body.vel.z;
            const len = Math.hypot(tx, tz);
            const step = PHYS.groundAccel * dt;
            const k = len > step ? step / len : 1;
            body.vel.x += tx * k;
            body.vel.z += tz * k;
        } else {
            this.coyote -= dt;
            const before = Math.hypot(body.vel.x, body.vel.z);
            body.vel.x += wish.x * PHYS.airAccel * dt;
            body.vel.z += wish.z * PHYS.airAccel * dt;
            const after = Math.hypot(body.vel.x, body.vel.z);
            const cap = Math.max(before, speed);
            if (after > cap) {
                body.vel.x *= cap / after;
                body.vel.z *= cap / after;
            }
        }

        if (this.jumpQueued) {
            this.jumpQueued = false;
            if (this.coyote > 0) {
                body.vel.y = PHYS.jump;
                this.coyote = 0;
                body.onGround = false;
                this.game.sfx.jump();
            } else if (f.jumpsLeft > 0) {
                f.jumpsLeft--;
                this.stats.doubleJumps++;
                body.vel.y = PHYS.doubleJump;
                body.vel.x += wish.x * 3;
                body.vel.z += wish.z * 3;
                this.game.sfx.jump();
                this.fight.effects.burst(body.pos, new THREE.Vector3(0, -1, 0), f.color, 10, 5, 0.4, 2);
            }
        }

        // after the double jump, holding Space glides
        body.vel.y = jetStep(this.jet, {
            hold: k.has('Space'),
            armed: f.jumpsLeft === 0,
            onGround: body.onGround,
            vy: body.vel.y,
            dt,
        });
        f.jetting = this.jet.active;
        if (this.jet.active) this.stats.glide += dt;

        const fallSpeed = body.vel.y;
        this.fight.world.move(body, dt);
        if (!wasGround && body.onGround && fallSpeed < -8) this.vm.land = Math.min(1, -fallSpeed / 20);
    }

    updateWeapons(dt) {
        const W = WEAPONS[this.weapon];
        this.cooldown -= dt;
        if (this.switching > 0) this.switching -= dt;
        if (this.reloading > 0) {
            this.reloading -= dt;
            if (this.reloading <= 0) {
                this.reloading = 0;
                this.ammo[this.weapon] = W.mag;
            }
        }

        const trigger = this.fire || this.fireQueued;
        // a tap during a reload or weapon swap is dropped rather than fired seconds later
        if (this.reloading > 0 || this.switching > 0) this.fireQueued = false;
        if (trigger && this.cooldown <= 0 && this.reloading <= 0 && this.switching <= 0) {
            this.fireQueued = false;
            if (this.ammo[this.weapon] <= 0) {
                this.startReload();
                return;
            }
            this.ammo[this.weapon]--;
            this.cooldown = W.interval;
            const cam = this.game.gfx.camera;
            const dir = cam.getWorldDirection(this._v.set(0, 0, 0));
            if (this.weapon === 'rifle') {
                const spread = W.spread * (this.f.body.onGround ? 1 : 2.5) * (1 - this.ads);
                dir.x += (Math.random() - 0.5) * spread * 2;
                dir.y += (Math.random() - 0.5) * spread * 2;
                dir.z += (Math.random() - 0.5) * spread * 2;
                dir.normalize();
                const muzzle = this.scoped
                    ? cam.position.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.15, 0))
                    : this.vm.muzzleWorld('rifle', this.game.gfx.viewCamera, cam, this._m).clone();
                this.fight.fireHitscan(this.f, cam.position.clone(), dir, W, muzzle);
                this.vm.recoil = Math.min(1.4, this.vm.recoil + 0.7);
                this.f.pitch = Math.min(1.5, this.f.pitch + 0.004);
                this.game.sfx.laser(true);
            } else {
                const muzzle = this.vm.muzzleWorld('launcher', this.game.gfx.viewCamera, cam, this._m).clone();
                this.fight.launch(this.f, muzzle, dir);
                this.vm.recoil = 1.6;
                this.shake = Math.max(this.shake, 0.25);
                this.game.sfx.lob();
            }
            if (this.ammo[this.weapon] <= 0) this.startReload();
        }
    }

    update(dt) {
        const f = this.f;
        const cam = this.game.gfx.camera;
        const active = f.alive && this.fight.live;
        if (active) {
            this.updateMovement(dt);
        } else {
            this.fireQueued = false;
            this.jumpQueued = false;
            f.jetting = false;
            this.jet.active = false;
        }

        this.edgeTurn(dt);

        if (active) {
            // shots leave from this frame's eye along this frame's look, not where last frame left the camera
            cam.position.set(f.body.pos.x, f.body.pos.y + PHYS.eye, f.body.pos.z);
            cam.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
            this.updateWeapons(dt);
        }

        // camera (placed again so this frame's recoil and shake show)
        if (f.alive) {
            this.shake *= Math.exp(-dt * 8);
            cam.position.set(f.body.pos.x, f.body.pos.y + PHYS.eye, f.body.pos.z);
            if (this.shake > 0.001) {
                cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
                cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
            }
            cam.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
        }
        // aim down sights: blend toward the weapon's zoom; the rifle switches to its scope near full aim
        const canAds = f.alive && this.canLook() && this.reloading <= 0 && this.switching <= 0;
        this.ads += ((this.aiming && canAds ? 1 : 0) - this.ads) * (1 - Math.exp(-dt * AIM.rate));
        const rifle = this.weapon === 'rifle';
        this.scoped = rifle && this.ads > AIM.scopeAt;
        this.fov = BASE_FOV + ((rifle ? AIM.rifleFov : AIM.lobberFov) - BASE_FOV) * this.ads;
        if (Math.abs(cam.fov - this.fov) > 0.01) {
            cam.fov = this.fov;
            cam.updateProjectionMatrix();
        }

        const showVm = f.alive && !this.scoped && this.fight.state !== 'flight';
        this.game.gfx.layers.view.enabled = showVm;
        this.game.hud.setScope(this.scoped && f.alive);
        this.game.hud.setCrosshair(f.alive && !this.scoped, this.ads > 0.5);
        this.vm.setWeapon(this.weapon);
        const speed = Math.hypot(f.body.vel.x, f.body.vel.z);
        this.vm.update(dt, {
            speed,
            onGround: f.body.onGround,
            reload: this.reloading > 0 ? 1 - this.reloading / WEAPONS[this.weapon].reload : 0,
            switching: this.switching > 0.16,
            ads: this.ads,
            weapon: this.weapon,
        });
        const W = WEAPONS[this.weapon];
        this.game.hud.setWeapon(this.weapon, W.label, this.ammo[this.weapon], W.mag, this.reloading > 0);
        this.game.hud.setJet(this.jet.fuel / JET.fuel, this.jet.active);
        this.game.sfx.setJet(this.jet.active && this.fight.live ? 1 : 0);
        this.updateAimUi();
    }

    // Hide the OS cursor while free-aiming and explain the mode once a lock attempt has failed.
    updateAimUi() {
        const s = this.fight.state;
        const playing = !this.fight.paused && (s === 'live' || s === 'countdown');
        const free = playing && !this.locked;
        document.body.classList.toggle('free-aim', free);
        let hint = '';
        if (free && !this.fight.lock.pending) {
            hint = this.fight.lockDenied
                ? '<b>FREE AIM</b> mouse lock is blocked here · ' +
                  'rest the cursor on a screen edge to keep turning · ESC pauses'
                : '<b>FREE AIM</b> click to capture the mouse · or rest the cursor on a screen edge to keep turning';
        }
        this.game.hud.setMouseHint(hint);
    }

    dispose() {
        document.body.classList.remove('free-aim');
        this.game.hud.setMouseHint('');
        this.unbind();
        this.vm.dispose(this.game.gfx.viewScene);
        this.game.gfx.layers.view.enabled = false;
    }
}
