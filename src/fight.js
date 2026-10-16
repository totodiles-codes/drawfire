import * as THREE from 'three';
import { PHYS, TIMING, WEAPONS } from './config.js';
import { World } from './physics.js';
import { Effects } from './effects.js';
import { Astronaut } from './character.js';
import { PlayerController } from './player.js';
import { BotBrain } from './bot.js';
import { Rng } from './rng.js';
import { dummySpots } from './tutorial.js';
import { hex } from './hud.js';

// The fight on the freshly drawn map.

const _ray = new THREE.Ray();
const _c = new THREE.Vector3();
const _hit = new THREE.Vector3();
// Remembered for the whole session so we stop auto-retrying a lock this host keeps refusing.
let lockDenied = false;
// Set only for refusals that can never succeed here (sandboxed frames): not even deploy/resume retry.
let lockBlocked = false;

const HITBOXES = [
    { y: 1.56, r: 0.3, head: true },
    { y: 1.1, r: 0.4, head: false },
    { y: 0.55, r: 0.3, head: false },
];

class Fighter {
    constructor(who, scene) {
        this.who = who;
        this.name = who.name;
        this.team = who.team;
        this.color = who.color;
        this.isPlayer = who.isPlayer;
        this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false };
        this.yaw = 0;
        this.pitch = 0;
        this.health = 100;
        this.alive = false;
        this.respawn = 0;
        this.invuln = 0;
        this.jumpsLeft = 1;
        this.lastDamager = null;
        this.lastDamageTime = -99;
        this.flash = 0;
        this.jetting = false;
        this.avatar = new Astronaut(who.color);
        this.avatar.root.visible = false;
        scene.add(this.avatar.root);
    }

    muzzle() {
        const p = this.body.pos;
        const sy = Math.sin(this.yaw);
        const cy = Math.cos(this.yaw);
        return new THREE.Vector3(p.x - sy * 0.65 + cy * 0.2, p.y + 1.15 + this.pitch * 0.3, p.z - cy * 0.65 - sy * 0.2);
    }
}

export class FightPhase {
    // tutorial: target dummies stand still and never shoot; no timer and no score limit
    constructor(game, { tutorial = false } = {}) {
        this.tutorial = tutorial;
        this.game = game;
        this.clock = 0;
        this.time = TIMING.fight;
        this.state = 'flight';
        this.paused = false;
        this.flightT = 0;
        this.rng = new Rng();
        this.scores = new Array(game.mode.teamCount).fill(0);
        this.streak = { count: 0, timer: 0 };

        this.world = new World();
        this.world.build([...game.arena.colliders, ...game.strokes.meshes()]);
        this.effects = new Effects(game.gfx.scene);
        this.projectiles = [];

        this.fighters = game.roster.map((who) => new Fighter(who, game.gfx.scene));
        this.player = this.fighters.find((f) => f.isPlayer);
        this.brains = this.fighters
            .filter((f) => !f.isPlayer && !f.who.dummy)
            .map((f) => {
                f.brain = new BotBrain(this, f, new Rng(Math.floor(this.rng.next() * 1e9)));
                return f.brain;
            });
        const dummies = this.fighters.filter((f) => f.who.dummy);
        dummySpots(game.arena, dummies.length).forEach((p, i) => {
            dummies[i].spot = p;
        });
        for (const f of this.fighters) this.spawn(f, true);
        this.controller = new PlayerController(this, this.player);

        const cam = game.gfx.camera;
        this.flightFrom = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
        this.game.hud.caption('NOW', 'FIGHT ON IT', 2.2);
        this.game.sfx.whoosh();

        // Pointer lock is an upgrade, never a gate: without it the player aims in free-mouse mode.
        // Some hosts (embedded preview panes, sandboxed iframes, unfocused windows) always refuse it.
        this.lock = { pending: false, timer: 0, lastExit: -1e9 };
        this.onLockChange = () => {
            const locked = document.pointerLockElement === game.gfx.renderer.domElement;
            this.controller.locked = locked;
            if (locked) {
                this.lockSettled(true);
                const playing = !this.paused && (this.state === 'live' || this.state === 'countdown');
                if (!playing) document.exitPointerLock?.();
            } else {
                this.lock.lastExit = performance.now();
                if (this.state === 'live' || this.state === 'countdown') this.pause();
            }
        };
        this.onLockError = () => this.lockSettled(false, { name: 'PointerLockError', message: '' });
        // free-mouse mode has no unlock event, so pause when the window loses focus or is hidden
        this.onBlur = () => {
            if (!this.controller.locked && (this.state === 'live' || this.state === 'countdown')) this.pause();
        };
        this.onVisibility = () => {
            if (document.hidden && (this.state === 'live' || this.state === 'countdown')) this.pause();
        };
        document.addEventListener('pointerlockchange', this.onLockChange);
        document.addEventListener('pointerlockerror', this.onLockError);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('visibilitychange', this.onVisibility);
    }

    get live() {
        return this.state === 'live' && !this.paused;
    }

    get lockDenied() {
        return lockDenied;
    }

    // ---------- spawning ----------
    spawn(f, initial = false) {
        const sp = this.game.arena.spawns[f.team];
        let best = null;
        for (let i = 0; i < 8; i++) {
            const a = this.rng.range(0, Math.PI * 2);
            const r = initial ? this.rng.range(0, sp.area * 0.8) : this.rng.range(0, sp.area * 0.6);
            const p = new THREE.Vector3(sp.center.x + Math.cos(a) * r, 0.2, sp.center.z + Math.sin(a) * r);
            if (f.isPlayer) p.set(sp.center.x, 0.2, sp.center.z);
            if (f.spot) p.copy(f.spot);
            let near = Infinity;
            for (const o of this.fighters) {
                if (o === f || !o.alive) continue;
                near = Math.min(near, o.body.pos.distanceTo(p));
            }
            if (!best || near > best.near) best = { p, near };
            if (near > 2.5) break;
        }
        f.body.pos.copy(best.p);
        f.body.vel.set(0, 0, 0);
        f.body.onGround = false;
        f.yaw = sp.yaw + (f.isPlayer || f.spot ? 0 : this.rng.range(-0.3, 0.3));
        // dummies face the player's spawn
        if (f.spot) f.yaw = this.game.arena.spawns[0].yaw + Math.PI;
        f.pitch = 0;
        f.health = 100;
        f.alive = true;
        f.invuln = initial ? 0 : 1.5;
        f.lastDamager = null;
        f.avatar.revive();
        f.avatar.root.visible = !f.isPlayer;
        f.avatar.root.position.copy(f.body.pos);
        f.avatar.root.rotation.set(0, f.yaw, 0);
        f.brain?.onSpawn();
        if (f.isPlayer) this.controller?.resetForSpawn();
    }

    // ---------- combat ----------
    rayFighters(shooter, origin, dir, maxDist) {
        _ray.origin.copy(origin);
        _ray.direction.copy(dir);
        let best = null;
        for (const o of this.fighters) {
            if (o === shooter || !o.alive || o.team === shooter.team) continue;
            const p = o.body.pos;
            for (const hb of HITBOXES) {
                _c.set(p.x, p.y + hb.y, p.z);
                if (_ray.distanceSqToPoint(_c) > hb.r * hb.r) continue;
                const hit = _ray.intersectSphere({ center: _c, radius: hb.r }, _hit);
                if (!hit) continue;
                const d = hit.distanceTo(origin);
                if (d < maxDist && (!best || d < best.dist)) best = { f: o, dist: d, head: hb.head };
            }
        }
        return best;
    }

    fireHitscan(shooter, origin, dir, W, muzzle) {
        const range = W.range ?? 200;
        const wall = this.world.raycast(origin, dir, range);
        const maxDist = wall ? wall.distance : range;
        const target = this.rayFighters(shooter, origin, dir, maxDist);
        const end = origin.clone().addScaledVector(dir, target ? target.dist : maxDist);
        // a beam that ends in the player's face would fill the screen; stop it a little short
        const beamEnd = target?.f.isPlayer ? end.clone().addScaledVector(dir, -2.5) : end;
        this.effects.beam(muzzle, beamEnd, shooter.color);
        this.effects.muzzle(muzzle, shooter.color);
        if (target) {
            const dmg = W.damage * (target.head ? W.headMult : 1);
            this.damage(target.f, dmg, shooter, 'rifle', dir, target.head);
            this.effects.impact(end, dir.clone().negate(), target.f.color);
        } else if (wall) {
            this.effects.impact(wall.point, wall.normal, shooter.color);
        }
        if (!shooter.isPlayer) {
            const cam = this.game.gfx.camera;
            const d = cam.position.distanceTo(origin);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            const pan = right.dot(origin.clone().sub(cam.position).normalize());
            this.game.sfx.laser(false, d, pan);
        }
    }

    launch(shooter, origin, dir) {
        const W = WEAPONS.launcher;
        const vel = dir.clone().multiplyScalar(W.speed);
        vel.addScaledVector(shooter.body.vel, 0.3);
        vel.y += 2;
        const orb = this.effects.createOrb(shooter.color);
        orb.position.copy(origin);
        this.projectiles.push({ pos: origin.clone(), vel, owner: shooter, orb, life: 4 });
        this.effects.muzzle(origin, shooter.color);
    }

    updateProjectiles(dt) {
        const W = WEAPONS.launcher;
        for (const pr of this.projectiles) {
            pr.life -= dt;
            pr.vel.y -= W.gravity * dt;
            const step = pr.vel.clone().multiplyScalar(dt);
            const len = step.length();
            const dir = step.clone().divideScalar(len || 1);
            const wall = this.world.raycast(pr.pos, dir, len + 0.2);
            const hitF = this.rayFighters(pr.owner, pr.pos, dir, len + 0.35);
            if (hitF || wall || pr.life <= 0 || pr.pos.y < PHYS.killY) {
                const at = hitF
                    ? pr.pos.clone().addScaledVector(dir, hitF.dist)
                    : wall
                      ? wall.point.clone().addScaledVector(wall.normal, 0.3)
                      : pr.pos.clone();
                this.explode(at, pr.owner);
                pr.dead = true;
                this.effects.removeOrb(pr.orb);
                continue;
            }
            pr.pos.add(step);
            pr.orb.position.copy(pr.pos);
            this.effects.trail(pr.pos, pr.owner.color);
            this.effects.trail(pr.pos, 0xffffff);
        }
        this.projectiles = this.projectiles.filter((p) => !p.dead);
    }

    explode(at, owner) {
        const W = WEAPONS.launcher;
        this.effects.explosion(at, owner.color);
        const cam = this.game.gfx.camera;
        const d = cam.position.distanceTo(at);
        this.game.sfx.explosion(d, 0);
        this.controller.shake = Math.max(this.controller.shake, Math.max(0, 1 - d / 30) * 0.9);
        for (const o of this.fighters) {
            if (!o.alive) continue;
            _c.set(o.body.pos.x, o.body.pos.y + 1.0, o.body.pos.z);
            const dist = _c.distanceTo(at);
            if (dist > W.radius) continue;
            const k = 1 - dist / W.radius;
            const push = _c.clone().sub(at);
            push.y = Math.max(push.y, 0.4);
            push.normalize().multiplyScalar(W.knockback * k);
            o.body.vel.add(push);
            o.body.onGround = false;
            if (o !== owner && o.team !== owner.team) {
                if (this.world.lineOfSight(at, _c)) {
                    this.damage(o, W.damage * (0.25 + 0.75 * k), owner, 'launcher', push);
                }
            }
        }
    }

    // Tutorial dummies don't think; they only get pushed around (lobber knockback) and can fall.
    updateDummy(f, dt) {
        const k = Math.exp(-dt * 8);
        f.body.vel.x *= k;
        f.body.vel.z *= k;
        this.world.move(f.body, dt);
    }

    damage(target, amount, source, weapon, dir, head = false) {
        // the result is final once the match is over (later hits in the same frame don't count)
        if (!target.alive || target.invuln > 0 || this.state === 'over') return;
        if (source?.isPlayer) this.controller.countHit(weapon);
        target.health -= amount;
        target.lastDamager = source;
        target.lastDamageTime = this.clock;
        target.flash = 0.08;
        if (target.isPlayer) {
            this.game.hud.damage(amount);
            this.game.sfx.hurt();
            this.controller.shake = Math.max(this.controller.shake, 0.15);
        }
        if (source?.isPlayer && target.health > 0) {
            this.game.hud.hitmarker(false, head);
            this.game.sfx.hit(head);
        }
        if (target.brain && source && !target.brain.target) {
            target.brain.target = source;
            target.brain.lastSeen.copy(source.body.pos);
            target.brain.lastSeenTime = this.clock;
        }
        if (target.health <= 0) this.kill(target, source, weapon, dir);
    }

    kill(victim, killer, weapon, dir) {
        // no deaths after the final kill either (falls that frame), so no respawn or death cam is left running
        if (this.state === 'over') return;
        victim.alive = false;
        victim.health = 0;
        victim.jetting = false;
        victim.respawn = TIMING.respawn;
        victim.who.deaths++;
        victim.killer = killer;
        victim.deathPos = victim.body.pos.clone();
        const credited = killer && killer !== victim && killer.team !== victim.team;
        if (credited) {
            killer.who.kills++;
            this.scores[killer.team]++;
        }
        this.game.hud.killfeed(credited ? killer : null, victim, weapon);
        _c.set(victim.body.pos.x, victim.body.pos.y + 1.1, victim.body.pos.z);
        this.effects.deathBurst(_c, victim.color);
        const impulse = dir ? dir.clone().normalize().multiplyScalar(5) : new THREE.Vector3();
        victim.body.vel.addScaledVector(impulse, 1.2);
        victim.body.vel.y += 6;
        victim.avatar.die(impulse);
        victim.avatar.root.visible = true;

        if (victim.isPlayer) {
            this.game.sfx.death();
            this.controller.releaseInputs();
            this.deathCam = { from: this.game.gfx.camera.position.clone() };
        }
        if (credited && killer.isPlayer) {
            this.game.hud.hitmarker(true);
            this.game.sfx.kill();
            this.streak.count = this.streak.timer > 0 ? this.streak.count + 1 : 1;
            this.streak.timer = 3.5;
            const names = { 2: 'DOUBLE', 3: 'TRIPLE', 4: 'QUAD', 5: 'MEGA' };
            if (this.streak.count >= 2) this.game.hud.caption(names[Math.min(5, this.streak.count)], 'KILL', 1.6);
        }
        this.checkWin();
    }

    checkWin() {
        if (this.tutorial) return;
        const limit = this.game.mode.scoreLimit;
        if (this.scores.some((s) => s >= limit)) this.finish();
    }

    // ---------- pointer lock ----------
    // explicit: called from a deliberate click (deploy/resume), so retry even after an earlier refusal.
    tryLock(explicit = false) {
        const L = this.lock;
        const canvas = this.game.gfx.renderer.domElement;
        if (!canvas.requestPointerLock) {
            lockDenied = true;
            return;
        }
        if (this.controller.locked || L.pending) return;
        if ((lockDenied && !explicit) || lockBlocked) return;
        L.pending = true;
        clearTimeout(L.timer);
        // Firefox / older Safari return undefined and may fail silently, so also time out
        L.timer = setTimeout(() => this.lockSettled(false, { name: 'TimeoutError', message: '' }), 1500);
        try {
            const p = canvas.requestPointerLock();
            p?.catch?.((err) => this.lockSettled(false, err));
        } catch (err) {
            this.lockSettled(false, err);
        }
    }

    lockSettled(ok, err) {
        const L = this.lock;
        const wasPending = L.pending;
        L.pending = false;
        clearTimeout(L.timer);
        if (ok) {
            lockDenied = false;
            return;
        }
        // browsers can report one refusal several ways (rejection + pointerlockerror + timeout)
        if (!wasPending) return;
        const msg = String(err?.message);
        // Chrome refuses for ~1 s after the user leaves the lock with Esc; that's not a real denial
        const cooldown = /exited the lock/i.test(msg) || performance.now() - L.lastExit < 1500;
        if (!cooldown) lockDenied = true;
        // a sandboxed frame can never lock, so stop asking (each attempt logs a console error)
        if (/sandbox|allow-pointer-lock/i.test(msg)) lockBlocked = true;
    }

    // ---------- flow ----------
    pause() {
        // only a running match can pause (not the flight, the deploy panel or the wind-down)
        if (this.paused || (this.state !== 'live' && this.state !== 'countdown')) return;
        this.paused = true;
        this.controller.releaseInputs();
        this.game.sfx.setJet(0);
        const settings = this.game.settings;
        const setAim = (mode, d, e) => {
            settings.aimMode = mode;
            this.game.saveSettings();
            this.controller.releaseInputs();
            panel.querySelectorAll('[data-aim]').forEach((b) => b.classList.toggle('on', b.dataset.aim === mode));
            // don't let Space/Enter (resume keys) also press the focused button
            e?.currentTarget?.blur?.();
        };
        const panel = this.game.hud.showPanel(
            `<div class="kicker">PAUSED</div>
             <div class="row-btns">
               <button class="btn primary" data-act="resume"><b>RESUME</b><span>click or press enter</span></button>
               <button class="btn" data-act="quit"><b>QUIT</b><span>back to menu</span></button>
             </div>
             <label class="slider">SENSITIVITY
               <input type="range" min="0.3" max="2.5" step="0.05" value="${settings.sensitivity}">
             </label>
             <div class="setting">AIM
               <button class="seg" data-act="aimHold" data-aim="hold">HOLD</button>
               <button class="seg" data-act="aimToggle" data-aim="toggle">TOGGLE</button>
             </div>
             <div class="setting-note">HOLD: hold RMB to aim, a quick tap keeps aiming until the next press ·
               Ctrl+click (Mac) always toggles</div>`,
            {
                resume: () => this.resume(),
                quit: () => this.game.showMenu(),
                aimHold: (d, e) => setAim('hold', d, e),
                aimToggle: (d, e) => setAim('toggle', d, e),
            },
        );
        setAim(settings.aimMode);
        this.game.hud.panel.classList.add('dim');
        panel.querySelector('.slider input').addEventListener('input', (e) => {
            settings.sensitivity = parseFloat(e.target.value);
            this.game.saveSettings();
        });
        this.bindPanelKeys(() => this.resume());
    }

    // Enter / Space also count as the user gesture pointer lock needs.
    bindPanelKeys(action) {
        this.unbindPanelKeys();
        this.panelKeys = (e) => {
            if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter') return;
            e.preventDefault();
            action();
        };
        window.addEventListener('keydown', this.panelKeys);
    }

    unbindPanelKeys() {
        if (this.panelKeys) window.removeEventListener('keydown', this.panelKeys);
        this.panelKeys = null;
    }

    closePanel() {
        this.unbindPanelKeys();
        if (this.panelClick) this.game.hud.panel.removeEventListener('click', this.panelClick);
        this.panelClick = null;
        this.game.hud.hidePanel();
        this.game.hud.panel.classList.remove('dim');
    }

    resume() {
        if (!this.paused || this.state === 'over') return;
        this.game.sfx.unlock();
        this.tryLock(true);
        this.closePanel();
        this.controller.releaseInputs();
        this.paused = false;
    }

    deploy() {
        if (this.state !== 'deploy') return;
        this.game.sfx.unlock();
        this.tryLock(true);
        this.closePanel();
        this.controller.releaseInputs();
        this.state = 'countdown';
        this.countdown = this.tutorial ? 1 : 3;
        this.lastCount = 4;
    }

    showDeploy() {
        this.closePanel();
        this.paused = false;
        this.state = 'deploy';
        const panel = this.game.hud.showPanel(
            `<button class="btn primary" data-act="go">
               <b>CLICK TO DEPLOY</b><span>mouse look · WASD move</span>
             </button>
             <div class="controls" style="margin-top:22px">
               <div><b>LMB</b>fire</div><div><b>RMB</b>aim (Mac: Ctrl+click)</div>
               <div><b>SPACE</b>jump · double-jump · hold to glide</div><div><b>SHIFT</b>sprint</div>
               <div><b>1 / 2 / Q</b>rifle / plasma lobber</div><div><b>R</b>reload · <b>ESC</b>pause</div>
             </div>`,
            { go: () => this.deploy() },
        );
        // clicking anywhere deploys, not just the button
        this.panelClick = (e) => {
            if (this.game.hud.panelClickAllowed(e)) this.deploy();
        };
        panel.addEventListener('click', this.panelClick);
        this.bindPanelKeys(() => this.deploy());
    }

    finish() {
        if (this.state === 'over') return;
        this.state = 'over';
        this.overTimer = 2.6;
        this.controller.releaseInputs();
        this.closePanel();
        this.controller.updateAimUi();
        document.exitPointerLock?.();
        const winner = this.winnerTeam();
        // a shared top score is a draw only for the teams sharing it; trailing them is still a defeat
        const tied = winner < 0 && this.scores[this.player.team] === Math.max(...this.scores);
        if (tied) this.game.hud.caption('DRAW', 'DEAD EVEN', 2.6);
        else if (winner === this.player.team) this.game.hud.caption('VICTORY', 'GG', 2.6);
        else this.game.hud.caption('DEFEAT', 'DRAW BETTER', 2.6);
        this.game.hud.centerMsg('');
    }

    // -1 when the top score is shared: a tie has no winner
    winnerTeam() {
        const top = Math.max(...this.scores);
        return this.scores.filter((s) => s === top).length > 1 ? -1 : this.scores.indexOf(top);
    }

    summary() {
        return { scores: [...this.scores], winner: this.winnerTeam(), fighters: this.fighters.map((f) => f.who) };
    }

    // ---------- per frame ----------
    update(dt) {
        const game = this.game;
        const cam = game.gfx.camera;

        if (this.state === 'flight') {
            this.flightT = Math.min(1, this.flightT + dt / TIMING.flight);
            const t = this.flightT;
            const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
            const p = this.player;
            const toPos = new THREE.Vector3(p.body.pos.x, p.body.pos.y + PHYS.eye, p.body.pos.z);
            const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0, 'YXZ'));
            const mid = this.flightFrom.pos.clone().lerp(toPos, e);
            mid.y += Math.sin(t * Math.PI) * 6;
            cam.position.copy(mid);
            cam.quaternion.copy(this.flightFrom.quat).slerp(toQuat, e);
            cam.fov = THREE.MathUtils.lerp(this.flightFrom.fov, 75, e);
            cam.updateProjectionMatrix();
            game.strokes.setFightLook(Math.min(1, t * 1.5));
            this.updateAvatars(dt);
            this.effects.update(dt);
            if (t >= 1) {
                game.strokes.setFightLook(1);
                this.controller.fov = 75;
                this.showDeploy();
            }
            this.updateHud();
            return;
        }

        if (this.state === 'over') {
            // slow-motion wind-down before the results screen
            const sdt = dt * 0.3;
            this.overTimer -= dt;
            this.updateAvatars(sdt);
            this.effects.update(sdt);
            if (this.overTimer <= 0) this.done = true;
            return;
        }

        if (this.paused || this.state === 'deploy') {
            this.controller.updateAimUi();
            this.updateHud();
            return;
        }

        if (this.state === 'countdown') {
            this.countdown -= dt;
            const n = Math.ceil(this.countdown);
            if (n !== this.lastCount && n > 0) {
                this.lastCount = n;
                game.sfx.beep(false);
            }
            game.hud.centerMsg(this.countdown > 0 ? `GET READY<span class="big">${n}</span>` : '');
            if (this.countdown <= 0) {
                this.state = 'live';
                game.sfx.beep(true);
                game.hud.caption('', 'FIGHT!', 1.2);
            }
        }

        this.clock += dt;
        if (this.state === 'live' && !this.tutorial) {
            this.time -= dt;
            if (this.time <= 0) {
                this.time = 0;
                this.finish();
                return;
            }
        }
        if (this.streak.timer > 0) this.streak.timer -= dt;

        for (const b of this.brains) if (this.live) b.update(dt);
        this.controller.update(dt);
        this.updateProjectiles(dt);

        for (const f of this.fighters) {
            if (f.invuln > 0) f.invuln -= dt;
            if (f.alive) {
                if (!f.isPlayer && !f.brain) this.updateDummy(f, dt);
                if (this.clock - f.lastDamageTime > 4 && f.health < 100) f.health = Math.min(100, f.health + 22 * dt);
                if (f.body.pos.y < PHYS.killY) {
                    const recent = f.lastDamager && this.clock - f.lastDamageTime < 6 ? f.lastDamager : null;
                    this.kill(f, recent, 'fall', null);
                }
            } else if (this.state !== 'over') {
                f.respawn -= dt;
                f.body.vel.x *= Math.exp(-dt * 2);
                f.body.vel.z *= Math.exp(-dt * 2);
                this.world.move(f.body, dt);
                if (f.respawn <= 0) this.spawn(f);
            }
        }
        if (this.state === 'over') return;

        // jet exhaust for everyone gliding (not in updateAvatars, which skips the hidden player avatar)
        for (const f of this.fighters) if (f.alive && f.jetting) this.effects.jetFlame(f.body.pos, f.yaw, f.color, dt);
        this.updateAvatars(dt);
        this.updateDeathCam(dt);
        this.effects.update(dt);
        this.updateHud();
    }

    updateAvatars(dt) {
        for (const f of this.fighters) {
            const a = f.avatar;
            if (!a.root.visible) continue;
            a.root.position.copy(f.body.pos);
            if (f.alive) {
                a.root.rotation.set(0, f.yaw, 0);
                a.animate(dt, Math.hypot(f.body.vel.x, f.body.vel.z), !f.body.onGround, f.pitch);
                const blink = f.invuln > 0 && Math.floor(f.invuln * 12) % 2 === 0;
                if (f.flash > 0) f.flash -= dt;
                a.setFlash(f.flash > 0 || blink);
            } else {
                a.tumble(dt);
                if (f.respawn < 1.4) a.root.visible = false;
            }
        }
    }

    updateDeathCam(dt) {
        const p = this.player;
        const cam = this.game.gfx.camera;
        if (p.alive) {
            this.deathCam = null;
            return;
        }
        const k = p.killer && p.killer !== p && p.killer.alive ? p.killer : null;
        const focus = k ? k.body.pos.clone().add(new THREE.Vector3(0, 1.2, 0)) : p.deathPos.clone();
        const goal = p.deathPos.clone().add(new THREE.Vector3(0, 4.5, 0));
        if (k) goal.addScaledVector(focus.clone().sub(goal).normalize(), -3);
        cam.position.lerp(goal, 1 - Math.exp(-dt * 3));
        const m = new THREE.Matrix4().lookAt(cam.position, focus, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        cam.quaternion.slerp(q, 1 - Math.exp(-dt * 5));
        const killer = p.killer && p.killer !== p ? p.killer : null;
        const who = killer ? `<span style="color:${hex(killer.color)}">${killer.name}</span>` : 'THE VOID';
        this.game.hud.centerMsg(`ELIMINATED BY ${who}<span class="big">${Math.max(1, Math.ceil(p.respawn))}</span>`);
    }

    updateHud() {
        const hud = this.game.hud;
        const mode = this.game.mode;
        const t = Math.max(0, Math.ceil(this.time));
        let scores;
        if (mode.layout === 'duel') {
            scores = [0, 1].map((team) => ({
                color: this.game.teamColors[team],
                value: this.scores[team],
                mine: team === this.player.team,
            }));
        } else {
            const mine = this.scores[this.player.team];
            let bestTeam = -1;
            for (let i = 0; i < this.scores.length; i++) {
                if (i !== this.player.team && (bestTeam < 0 || this.scores[i] > this.scores[bestTeam])) bestTeam = i;
            }
            scores = [
                { color: this.player.color, value: mine, mine: true },
                { color: this.game.teamColors[bestTeam], value: this.scores[bestTeam] },
            ];
        }
        if (this.tutorial) {
            hud.hideTop();
        } else {
            hud.setTop({
                header: `${mode.label} · FIRST TO ${mode.scoreLimit}`,
                timer: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
                hot: this.time <= 10,
                scores,
            });
        }
        hud.setHealth(this.player.health);
        if (this.player.alive && this.state !== 'countdown') hud.centerMsg('');
    }

    dispose() {
        this.game.sfx.setJet(0);
        clearTimeout(this.lock.timer);
        this.unbindPanelKeys();
        if (this.panelClick) this.game.hud.panel.removeEventListener('click', this.panelClick);
        this.panelClick = null;
        document.removeEventListener('pointerlockchange', this.onLockChange);
        document.removeEventListener('pointerlockerror', this.onLockError);
        window.removeEventListener('blur', this.onBlur);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.controller.dispose();
        for (const f of this.fighters) {
            this.game.gfx.scene.remove(f.avatar.root);
            f.avatar.dispose();
        }
        for (const p of this.projectiles) this.effects.removeOrb(p.orb);
        this.effects.dispose();
        // also cancels a request that is still pending, so it can't land on the next screen
        if (document.pointerLockElement || this.lock.pending) document.exitPointerLock?.();
        this.lock.pending = false;
        this.game.hud.centerMsg('');
    }
}
