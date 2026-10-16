import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FightPhase } from '../src/fight.js';
import { Hud } from '../src/hud.js';

function fighter(team, isPlayer = false) {
    return {
        name: `T${team}`,
        team,
        color: 0x3366ff,
        isPlayer,
        alive: true,
        health: 100,
        invuln: 0,
        who: { kills: 0, deaths: 0 },
        body: { pos: new THREE.Vector3(), vel: new THREE.Vector3() },
        avatar: { die() {}, root: { visible: false } },
    };
}

// Just enough of a running match for the scoring code (no scene, no DOM).
function match(scores, scoreLimit = 30) {
    const fight = Object.create(FightPhase.prototype);
    const captions = [];
    const feed = [];
    Object.assign(fight, {
        state: 'live',
        tutorial: false,
        scores: [...scores],
        clock: 0,
        streak: { count: 0, timer: 0 },
        effects: { deathBurst() {} },
        controller: { releaseInputs() {}, updateAimUi() {}, countHit() {} },
        game: {
            mode: { scoreLimit },
            sfx: { death() {}, kill() {}, hurt() {}, hit() {} },
            gfx: { camera: { position: new THREE.Vector3() } },
            hud: {
                caption: (a, b) => captions.push([a, b]),
                killfeed: (k, v) => feed.push([k, v]),
                centerMsg() {},
                hitmarker() {},
                damage() {},
                hidePanel() {},
                panel: { classList: { remove() {} } },
            },
        },
    });
    fight.player = fighter(0, true);
    return { fight, captions, feed };
}

describe('winnerTeam', () => {
    const winner = (scores) => match(scores).fight.winnerTeam();

    it('returns the team with the top score', () => {
        expect(winner([3, 5])).toBe(1);
        expect(winner([30, 12])).toBe(0);
        expect(winner([4, 10, 2, 9, 0, 0, 0, 0])).toBe(1);
    });

    it('has no winner when the top score is shared, even at 0-0', () => {
        expect(winner([12, 12])).toBe(-1);
        expect(winner([0, 0])).toBe(-1);
        expect(winner([10, 3, 10, 2, 0, 0, 0, 0])).toBe(-1);
    });
});

describe('finish', () => {
    beforeEach(() => vi.stubGlobal('document', {}));
    afterEach(() => vi.unstubAllGlobals());

    const caption = (scores) => {
        const { fight, captions } = match(scores);
        fight.finish();
        return captions.at(-1)[0];
    };

    it('calls a tie a draw instead of a win for the player team', () => {
        expect(caption([12, 12])).toBe('DRAW');
        expect(caption([0, 0])).toBe('DRAW');
        expect(caption([10, 2, 10])).toBe('DRAW');
    });

    it('still reports wins and losses', () => {
        expect(caption([13, 12])).toBe('VICTORY');
        expect(caption([12, 13])).toBe('DEFEAT');
    });

    it('is a defeat when other teams tie for first ahead of the player', () => {
        expect(caption([3, 10, 10, 2, 0, 0, 0, 0])).toBe('DEFEAT');
    });
});

describe('deploy panel', () => {
    beforeEach(() => vi.stubGlobal('window', new EventTarget()));
    afterEach(() => vi.unstubAllGlobals());

    it('deploys on a click anywhere, but not right after it appears or on a double-click', () => {
        const { fight } = match([0, 0]);
        const hud = fight.game.hud;
        hud.panel = Object.assign(new EventTarget(), { classList: { remove() {} } });
        hud.showPanel = () => {
            hud.panelShownAt = performance.now();
            return hud.panel;
        };
        hud.panelClickAllowed = Hud.prototype.panelClickAllowed;
        fight.game.sfx.unlock = () => {};
        fight.tryLock = vi.fn();
        const click = (detail) => hud.panel.dispatchEvent(new CustomEvent('click', { detail }));

        fight.showDeploy();
        // still clicking (firing) when the panel popped up
        click(1);
        expect(fight.state).toBe('deploy');
        hud.panelShownAt -= 500;
        // the second click of a double-click
        click(2);
        expect(fight.state).toBe('deploy');
        click(1);
        expect(fight.state).toBe('countdown');
        expect(fight.tryLock).toHaveBeenCalledWith(true);
    });
});

describe('scoring after the final kill', () => {
    beforeEach(() => vi.stubGlobal('document', {}));
    afterEach(() => vi.unstubAllGlobals());

    it('ignores kills later in the same frame once the score limit ended the match', () => {
        const { fight, feed, captions } = match([29, 29]);
        const a = fighter(0);
        const b = fighter(1);
        fight.kill(a, b, 'launcher', null);
        expect(fight.state).toBe('over');
        expect(fight.scores).toEqual([29, 30]);

        // a second orb from team 0 landing the same frame must not make it 30-30
        const victim = fighter(1);
        fight.kill(victim, a, 'launcher', null);
        expect(fight.scores).toEqual([29, 30]);
        expect(a.who.kills).toBe(0);
        expect(victim.who.deaths).toBe(0);
        expect(victim.alive).toBe(true);
        expect(feed).toHaveLength(1);
        expect(fight.winnerTeam()).toBe(1);
        expect(captions.at(-1)[0]).toBe('DEFEAT');
    });

    it('ignores falls and damage once the match is over', () => {
        const { fight } = match([30, 2]);
        fight.finish();
        const f = fighter(1);
        fight.damage(f, 500, fighter(0), 'rifle', new THREE.Vector3(0, 0, -1));
        expect(f.health).toBe(100);
        expect(f.alive).toBe(true);
        fight.kill(f, null, 'fall', null);
        expect(f.alive).toBe(true);
        expect(f.who.deaths).toBe(0);
        expect(fight.scores).toEqual([30, 2]);
    });
});
