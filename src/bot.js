import * as THREE from 'three';
import { BOT, PHYS, WEAPONS } from './config.js';
import { createJet, jetStep } from './jet.js';

// Fight-phase AI: pick a target it can see, strafe and shoot; otherwise push toward an objective.
// Ledge probes keep bots from walking off the drawn map; jumps get them over low walls.

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probe2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

export class BotBrain {
    constructor(fight, fighter, rng) {
        this.fight = fight;
        this.f = fighter;
        this.rng = rng;
        this.target = null;
        this.visible = false;
        this.lastSeen = new THREE.Vector3();
        this.lastSeenTime = -99;
        this.think = rng.range(0, 0.3);
        this.reaction = 0;
        this.aimError = new THREE.Vector2();
        this.strafe = rng.sign();
        this.strafeTimer = 0;
        this.objective = new THREE.Vector3();
        this.objectiveTimer = 0;
        this.cooldown = rng.range(0.2, 0.6);
        this.stuckTimer = 0;
        this.lastPos = new THREE.Vector3();
        this.blockedAir = 0;
        this.ammo = WEAPONS.rifle.mag;
        this.reloading = 0;
        this.skill = rng.range(0.75, 1.15);
        this.lastGround = new THREE.Vector3();
        this.navPoint = new THREE.Vector3();
        this.jet = createJet();
    }

    onSpawn() {
        this.jet = createJet();
        this.lastGround.copy(this.f.body.pos);
        this.target = null;
        this.visible = false;
        this.objectiveTimer = 0;
        this.ammo = WEAPONS.rifle.mag;
        this.reloading = 0;
    }

    eye(f, out) {
        return out.set(f.body.pos.x, f.body.pos.y + PHYS.eye, f.body.pos.z);
    }

    pickObjective() {
        const fight = this.fight;
        const rng = this.rng;
        const arena = fight.game.arena;
        const mode = fight.game.mode;
        if (mode.layout === 'duel') {
            const L = mode.length;
            const enemySign = this.f.team === 0 ? -1 : 1;
            const r = rng.next();
            if (r < 0.25) {
                this.objective.copy(arena.spawns[1 - this.f.team].center);
            } else {
                this.objective.set(rng.range(-1, 1), 0, enemySign * rng.range(-L * 0.15, L * 0.4));
            }
        } else {
            const others = fight.fighters.filter((o) => o !== this.f && o.alive && o.body.onGround);
            if (rng.chance(0.5) || !others.length) this.objective.set(rng.range(-3, 3), 0, rng.range(-3, 3));
            else this.objective.copy(rng.pick(others).body.pos);
        }
        this.objectiveTimer = rng.range(6, 12);
    }

    // Coarse waypoints over the fixed arena (bases, bridge / spokes, hub) so bots don't walk
    // straight at a goal across the void.
    navTarget(goal, out) {
        const mode = this.fight.game.mode;
        const p = this.f.body.pos;
        out.copy(goal);
        if (mode.layout === 'duel') {
            const front = mode.length / 2 - mode.baseSize / 2;
            const half = mode.baseSize / 2;
            const side = Math.sign(p.z) || 1;
            const onBase = Math.abs(p.z) > front - 0.3 && Math.abs(p.x) < half + 0.5;
            const goalOnThisBase = Math.sign(goal.z) === side && Math.abs(goal.z) > front;
            if (onBase && !goalOnThisBase) {
                out.set(0, 0, side * (front - 2));
            } else if (!onBase && Math.abs(p.x) < 2.2 && Math.abs(p.z) <= front) {
                // on the bridge: stay near its centre line
                const dz = goal.z - p.z;
                out.set(0, 0, p.z + Math.sign(dz) * Math.min(Math.abs(dz), 6));
                if (Math.abs(dz) < 6) out.x = THREE.MathUtils.clamp(goal.x, -1, 1);
            }
            return out;
        }
        const R = mode.radius;
        const padR = 5.2;
        const n = mode.teamCount;
        const padOf = (q) => {
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                if (Math.hypot(q.x - Math.sin(a) * R, q.z - Math.cos(a) * R) < padR + 0.5) return i;
            }
            return -1;
        };
        const spokeOf = (q) => {
            const r = Math.hypot(q.x, q.z);
            if (r < 7 || r > R - padR + 0.5) return -1;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const along = q.x * Math.sin(a) + q.z * Math.cos(a);
                const across = q.x * Math.cos(a) - q.z * Math.sin(a);
                if (along > 0 && Math.abs(across) < 1.8) return i;
            }
            return -1;
        };
        const myPad = padOf(p);
        const goalPad = padOf(goal);
        const mySpoke = spokeOf(p);
        const dirOf = (i) => {
            const a = (i / n) * Math.PI * 2;
            return [Math.sin(a), Math.cos(a)];
        };
        if (myPad >= 0 && goalPad !== myPad) {
            const [dx, dz] = dirOf(myPad);
            out.set(dx * (R - padR - 1.5), 0, dz * (R - padR - 1.5));
        } else if (mySpoke >= 0 && goalPad !== mySpoke) {
            out.set(0, 0, 0);
        } else if (mySpoke >= 0) {
            const [dx, dz] = dirOf(mySpoke);
            out.set(dx * R, 0, dz * R);
        } else if (Math.hypot(p.x, p.z) < 7.5 && goalPad >= 0) {
            const [dx, dz] = dirOf(goalPad);
            out.set(dx * 9, 0, dz * 9);
        }
        return out;
    }

    perceive() {
        const f = this.f;
        const fight = this.fight;
        this.eye(f, _eye);
        let best = null;
        let bestScore = Infinity;
        for (const o of fight.fighters) {
            if (o === f || !o.alive || o.team === f.team) continue;
            _to.set(o.body.pos.x, o.body.pos.y + 1.1, o.body.pos.z);
            const d = _to.distanceTo(_eye);
            if (d > BOT.sight) continue;
            // field of view check (generous) unless very close or already engaged
            _dir.subVectors(_to, _eye).normalize();
            const fwdX = -Math.sin(f.yaw);
            const fwdZ = -Math.cos(f.yaw);
            const facing = _dir.x * fwdX + _dir.z * fwdZ;
            if (facing < -0.2 && d > 12 && o !== this.target) continue;
            if (!fight.world.lineOfSight(_eye, _to)) continue;
            const score = d - (o === this.target ? 10 : 0) - (o.isPlayer ? 4 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = o;
            }
        }
        if (best) {
            if (best !== this.target) {
                this.reaction = BOT.reaction * this.rng.range(0.7, 1.4) / this.skill;
                this.aimError.set(this.rng.range(-0.25, 0.25), this.rng.range(-0.12, 0.12));
            }
            this.target = best;
            this.visible = true;
            this.lastSeen.copy(best.body.pos);
            this.lastSeenTime = fight.clock;
        } else {
            this.visible = false;
            if (this.target && (!this.target.alive || fight.clock - this.lastSeenTime > 3)) this.target = null;
        }
    }

    // Every sample along the next `dist` units needs footing we could drop onto safely
    // (at most ~2.5 below our feet) - catches gaps between strokes, not just the far edge.
    groundAhead(dir, dist) {
        const p = this.f.body.pos;
        for (const k of [0.45, 0.75, 1]) {
            _probe.set(p.x + dir.x * dist * k, p.y + 1.0, p.z + dir.z * dist * k);
            if (!this.fight.world.raycast(_probe, DOWN, 3.5)) return false;
        }
        return true;
    }

    // Is there something to land on past an obstacle we're about to jump?
    safeLanding(dir) {
        const p = this.f.body.pos;
        for (const d of [1.6, 3.0]) {
            _probe.set(p.x + dir.x * d, p.y + 4, p.z + dir.z * d);
            const hit = this.fight.world.raycast(_probe, DOWN, 9);
            if (hit && hit.distance > 0.5) return true;
        }
        return false;
    }

    // While airborne: will the current trajectory come down on something?
    overGround() {
        const b = this.f.body;
        const g = PHYS.gravity;
        const tLand = (b.vel.y + Math.sqrt(Math.max(0, b.vel.y * b.vel.y + 2 * g * 1.5))) / g;
        _probe.set(b.pos.x + b.vel.x * tLand, b.pos.y + 2, b.pos.z + b.vel.z * tLand);
        if (this.fight.world.raycast(_probe, DOWN, 12)) return true;
        _probe.set(b.pos.x, b.pos.y + 0.5, b.pos.z);
        return !!this.fight.world.raycast(_probe, DOWN, 6);
    }

    blockedAhead(dir) {
        const p = this.f.body.pos;
        _probe.set(p.x, p.y + 0.55, p.z);
        return !!this.fight.world.raycast(_probe, dir, 1.0);
    }

    update(dt) {
        const f = this.f;
        if (!f.alive) return;
        const fight = this.fight;

        this.think -= dt;
        if (this.think <= 0) {
            this.think = 0.18 + this.rng.range(0, 0.12);
            this.perceive();
        }
        this.objectiveTimer -= dt;
        if (this.objectiveTimer <= 0) this.pickObjective();

        // ----- aim -----
        let wantYaw = f.yaw;
        let wantPitch = 0;
        const t = this.target;
        this.eye(f, _eye);
        if (t) {
            const tp = this.visible ? t.body.pos : this.lastSeen;
            _aim.set(tp.x, tp.y + 1.15, tp.z);
            _dir.subVectors(_aim, _eye);
            const horiz = Math.hypot(_dir.x, _dir.z);
            wantYaw = Math.atan2(-_dir.x, -_dir.z) + this.aimError.x;
            wantPitch = Math.atan2(_dir.y, horiz) + this.aimError.y;
            this.aimError.multiplyScalar(Math.exp(-dt * 1.8 * this.skill));
        } else {
            _dir.subVectors(this.navPoint, f.body.pos);
            if (Math.hypot(_dir.x, _dir.z) > 0.5) wantYaw = Math.atan2(-_dir.x, -_dir.z);
        }
        const dy = angleDiff(wantYaw, f.yaw);
        const maxTurn = BOT.turnRate * dt;
        f.yaw += THREE.MathUtils.clamp(dy, -maxTurn, maxTurn);
        f.pitch += THREE.MathUtils.clamp(wantPitch - f.pitch, -maxTurn, maxTurn);

        // ----- shoot -----
        this.cooldown -= dt;
        if (this.reloading > 0) {
            this.reloading -= dt;
            if (this.reloading <= 0) this.ammo = WEAPONS.rifle.mag;
        }
        if (t && this.visible) {
            this.reaction -= dt;
            if (this.reaction <= 0 && Math.abs(dy) < 0.15 && this.cooldown <= 0 && this.reloading <= 0 && fight.live) {
                this.cooldown = BOT.interval * this.rng.range(0.8, 1.4);
                this.ammo--;
                if (this.ammo <= 0) this.reloading = WEAPONS.rifle.reload * 1.3;
                const spread = BOT.spread / this.skill;
                const dir = new THREE.Vector3(
                    -Math.sin(f.yaw) * Math.cos(f.pitch),
                    Math.sin(f.pitch),
                    -Math.cos(f.yaw) * Math.cos(f.pitch),
                );
                dir.x += this.rng.range(-spread, spread);
                dir.y += this.rng.range(-spread, spread) * 0.7;
                dir.z += this.rng.range(-spread, spread);
                dir.normalize();
                fight.fireHitscan(f, _eye.clone(), dir, { damage: BOT.damage, headMult: 1.6, range: 200 }, f.muzzle());
            }
        }

        // ----- move -----
        const body = f.body;
        let mx = 0;
        let mz = 0;
        if (t && this.visible) {
            _dir.subVectors(t.body.pos, body.pos);
            _dir.y = 0;
            const d = _dir.length();
            _dir.normalize();
            this.strafeTimer -= dt;
            if (this.strafeTimer <= 0) {
                this.strafe = this.rng.sign();
                this.strafeTimer = this.rng.range(0.6, 1.8);
            }
            // only strafe where there is room: try the chosen side, then the other, else hold still
            _to.set(-_dir.z * this.strafe, 0, _dir.x * this.strafe);
            let strafe = 0.9;
            if (!this.groundAhead(_to, 2.2)) {
                this.strafe *= -1;
                _to.negate();
                if (!this.groundAhead(_to, 2.2)) strafe = 0;
            }
            let approach = d > 30 ? 1 : d < 9 ? -0.6 : 0.15;
            _probe2.copy(_dir).multiplyScalar(Math.sign(approach));
            if (!this.groundAhead(_probe2, 1.8)) approach = 0;
            mx = _dir.x * approach + _to.x * strafe;
            mz = _dir.z * approach + _to.z * strafe;
        } else {
            const goal = t ? this.lastSeen : this.objective;
            if (body.pos.distanceTo(goal) < 2.5) {
                this.objectiveTimer = Math.min(this.objectiveTimer, 0.5);
            } else {
                this.navTarget(goal, this.navPoint);
                _dir.subVectors(this.navPoint, body.pos);
                _dir.y = 0;
                if (_dir.lengthSq() > 0.01) {
                    _dir.normalize();
                    mx = _dir.x;
                    mz = _dir.z;
                }
            }
        }
        const wish = new THREE.Vector3(mx, 0, mz);
        let moving = wish.lengthSq() > 1e-4;
        if (moving) {
            wish.normalize();
            if (body.onGround && !this.groundAhead(wish, 1.4)) {
                // look for a safe heading nearby
                const base = Math.atan2(wish.x, wish.z);
                let found = false;
                for (const off of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
                    const a = base + off;
                    _to.set(Math.sin(a), 0, Math.cos(a));
                    if (this.groundAhead(_to, 1.4)) {
                        wish.copy(_to);
                        found = true;
                        break;
                    }
                }
                if (!found) moving = false;
                if (t && this.visible) this.strafe *= -1;
                // brake so momentum doesn't carry us over the edge we just spotted
                body.vel.x *= 0.6;
                body.vel.z *= 0.6;
            }
        }

        const speed = 7.6;
        this.recovering = !body.onGround && !this.overGround();
        if (this.recovering) {
            // over the void: steer back to the last safe footing and burn the double jump
            wish.set(this.lastGround.x - body.pos.x, 0, this.lastGround.z - body.pos.z);
            moving = wish.lengthSq() > 0.01;
            if (moving) wish.normalize();
            if (f.jumpsLeft > 0 && body.vel.y < -1) {
                f.jumpsLeft--;
                body.vel.y = PHYS.doubleJump;
                body.vel.x = wish.x * speed;
                body.vel.z = wish.z * speed;
            }
        }
        if (body.onGround) {
            f.jumpsLeft = 1;
            this.lastGround.copy(body.pos);
            const tx = (moving ? wish.x * speed : 0) - body.vel.x;
            const tz = (moving ? wish.z * speed : 0) - body.vel.z;
            const len = Math.hypot(tx, tz);
            const step = PHYS.groundAccel * dt;
            const k = len > step ? step / len : 1;
            body.vel.x += tx * k;
            body.vel.z += tz * k;
            if (moving && this.blockedAhead(wish)) {
                if (this.safeLanding(wish)) {
                    body.vel.y = PHYS.jump;
                    this.blockedAir = 0.6;
                } else {
                    // nothing behind the wall: walk around it instead
                    this.objectiveTimer = Math.min(this.objectiveTimer, 0.2);
                    this.strafe *= -1;
                }
            }
        } else if (moving && (this.recovering || this.blockedAir > 0)) {
            // air control only to clear an obstacle we jumped at, or to get back to safe footing
            const air = this.recovering ? 1.6 : 0.6;
            const before = Math.hypot(body.vel.x, body.vel.z);
            body.vel.x += wish.x * PHYS.airAccel * air * dt;
            body.vel.z += wish.z * PHYS.airAccel * air * dt;
            const h = Math.hypot(body.vel.x, body.vel.z);
            const cap = Math.max(speed, before);
            if (h > cap) {
                body.vel.x *= cap / h;
                body.vel.z *= cap / h;
            }
            if (
                this.blockedAir < 0.15 &&
                f.jumpsLeft > 0 &&
                body.vel.y < 1 &&
                this.blockedAhead(wish) &&
                this.safeLanding(wish)
            ) {
                f.jumpsLeft--;
                body.vel.y = PHYS.doubleJump;
            }
        }

        if (!body.onGround) this.blockedAir = Math.max(0, this.blockedAir - dt * 0.5);
        // glide back to safety once the double jump is spent
        body.vel.y = jetStep(this.jet, {
            hold: this.recovering,
            armed: f.jumpsLeft === 0,
            onGround: body.onGround,
            vy: body.vel.y,
            dt,
        });
        f.jetting = this.jet.active;
        fight.world.move(body, dt);

        // unstick
        if (moving && body.pos.distanceToSquared(this.lastPos) < (0.4 * dt) ** 2) {
            this.stuckTimer += dt;
            if (this.stuckTimer > 1.2) {
                this.stuckTimer = 0;
                this.pickObjective();
                if (body.onGround) body.vel.y = PHYS.jump;
            }
        } else {
            this.stuckTimer = Math.max(0, this.stuckTimer - dt);
        }
        this.lastPos.copy(body.pos);
    }
}
