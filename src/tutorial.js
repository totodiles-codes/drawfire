import * as THREE from 'three';

// Interactive tutorial: a checklist that ticks off as the player does each thing.

// A ribbon whose ends differ in height and distance like a usable slope.
export function isRampStroke(s) {
    if (s.tool !== 'ribbon' || s.points.length < 2) return false;
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    const rise = Math.abs(b.y - a.y);
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    return rise >= 1.5 && run >= 2.5 && rise / run <= 2.5;
}

export const STEPS = [
    {
        id: 'ramp',
        phase: 'draw',
        text: 'Press <b>1</b> RIBBON and drag a diagonal line upward: a ramp',
        done: (s) => s.strokes.some(isRampStroke),
    },
    {
        id: 'path',
        phase: 'draw',
        text: 'Press <b>2</b> GROUND and draw a line on the bridge: a flat path',
        done: (s) => s.strokes.some((x) => x.tool === 'ground' && !x.closed),
    },
    {
        id: 'platform',
        phase: 'draw',
        text: 'With GROUND, draw a closed loop: it becomes a platform',
        done: (s) => s.strokes.some((x) => x.tool === 'ground' && x.closed),
    },
    {
        id: 'wall',
        phase: 'draw',
        text: 'Press <b>3</b> WALL and draw a line: cover to hide behind',
        done: (s) => s.strokes.some((x) => x.tool === 'wall'),
    },
    {
        id: 'rotate',
        phase: 'draw',
        text: 'Rotate the view: right-drag (Mac: Ctrl-drag) or hold <b>A</b> / <b>D</b>',
        done: (s) => s.turned >= 0.6,
    },
    {
        id: 'ready',
        phase: 'draw',
        text: 'Press <b>READY</b> (Enter) to start the fight',
        done: (s) => s.ready || s.fight,
    },
    {
        id: 'deploy',
        phase: 'fight',
        text: 'Click to deploy',
        done: (s) => s.fightState === 'countdown' || s.fightState === 'live',
    },
    { id: 'walk', phase: 'fight', text: 'Walk around with <b>W A S D</b>', done: (s) => s.walked >= 8 },
    {
        id: 'jump',
        phase: 'fight',
        text: 'Jump with <b>SPACE</b>, press it again in the air: double jump',
        done: (s) => s.doubleJumps >= 1,
    },
    {
        id: 'glide',
        phase: 'fight',
        text: 'Double jump and keep holding <b>SPACE</b> to glide',
        done: (s) => s.glide >= 0.8,
    },
    {
        id: 'shoot',
        phase: 'fight',
        text: 'Shoot a dummy with the laser rifle (<b>LMB</b>)',
        done: (s) => s.hits.rifle >= 1,
    },
    {
        id: 'aim',
        phase: 'fight',
        text: 'Aim with <b>RMB</b> (hold, or tap to keep aiming; Mac: Ctrl+click) and hit a dummy',
        done: (s) => s.hits.aimed >= 1,
    },
    {
        id: 'lobber',
        phase: 'fight',
        text: 'Press <b>2</b> for the plasma lobber and hit a dummy',
        done: (s) => s.hits.launcher >= 1,
    },
];

// Moves past every step that is already done; never goes back.
export function advance(steps, index, snap) {
    while (index < steps.length && steps[index].done(snap)) index++;
    return index;
}

// Where the target dummies stand: in front of the player's spawn, on the base and down the bridge.
export function dummySpots(arena, n) {
    const sp = arena.spawns[0];
    const fwd = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw));
    const right = new THREE.Vector3(Math.cos(sp.yaw), 0, -Math.sin(sp.yaw));
    const at = (f, r) => sp.center.clone().addScaledVector(fwd, f).addScaledVector(right, r).setY(0.2);
    return [at(16, 0), at(5, 4), at(24, 0), at(5, -4)].slice(0, n);
}

export class Tutorial {
    constructor(game) {
        this.game = game;
        this.steps = STEPS;
        this.index = 0;
        this.walked = 0;
        this.turned = 0;
        this.lastPos = null;
        this.lastOrbit = null;
        this.doneTimer = -1;
        game.hud.showGuide(
            this.steps.map((s) => s.text),
            { onSkipStep: () => this.skipStep(), onSkip: () => this.skip() },
        );
        game.hud.setGuide(0);
    }

    snapshot() {
        const g = this.game;
        const ph = g.phase;
        const snap = {
            strokes: [],
            ready: false,
            turned: this.turned,
            fight: g.state === 'fight',
            fightState: null,
            walked: this.walked,
            doubleJumps: 0,
            glide: 0,
            hits: { rifle: 0, launcher: 0, aimed: 0 },
        };
        if (g.state === 'draw' && ph?.myStrokes) {
            snap.strokes = ph.myStrokes;
            snap.ready = ph.ready;
        }
        if (snap.fight && ph?.controller) {
            const st = ph.controller.stats;
            snap.fightState = ph.state;
            snap.doubleJumps = st.doubleJumps;
            snap.glide = st.glide;
            snap.hits = st.hits;
        }
        return snap;
    }

    // READY is allowed once every drawing step before it is done (or skipped).
    readyAllowed() {
        return this.index >= this.steps.findIndex((s) => s.id === 'ready');
    }

    update(dt) {
        const g = this.game;
        const ph = g.phase;
        if (g.state === 'draw' && ph?.orbit) {
            const o = ph.orbit;
            if (this.lastOrbit) {
                this.turned += Math.abs(o.azimuth - this.lastOrbit.az) + Math.abs(o.elevation - this.lastOrbit.el);
            }
            this.lastOrbit = { az: o.azimuth, el: o.elevation };
        }
        if (g.state === 'fight' && ph?.player) {
            const p = ph.player;
            if (ph.live && p.alive && p.body.onGround) {
                // ignore jumps from respawns
                if (this.lastPos) {
                    const d = Math.hypot(p.body.pos.x - this.lastPos.x, p.body.pos.z - this.lastPos.z);
                    if (d < 3) this.walked += d;
                }
                this.lastPos = p.body.pos.clone();
            } else {
                this.lastPos = null;
            }
            const firstFight = this.steps.findIndex((s) => s.phase === 'fight');
            if (this.index < firstFight) this.setIndex(firstFight);
        }

        const next = advance(this.steps, this.index, this.snapshot());
        if (next !== this.index) this.setIndex(next);

        if (this.index >= this.steps.length) {
            if (this.doneTimer < 0) {
                this.doneTimer = 1.5;
                g.hud.caption('TUTORIAL', 'COMPLETE', 2);
            }
            this.doneTimer -= dt;
            if (this.doneTimer <= 0) g.finishTutorial();
        }
    }

    setIndex(i) {
        if (i > this.index) this.game.sfx.kill();
        this.index = Math.min(i, this.steps.length);
        this.game.hud.setGuide(this.index);
    }

    skipStep() {
        if (this.index < this.steps.length) this.setIndex(this.index + 1);
    }

    skip() {
        this.game.settings.tutorialDone = true;
        this.game.saveSettings();
        this.game.showMenu();
    }

    dispose() {
        this.game.hud.hideGuide();
    }
}
