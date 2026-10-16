import './style.css';
import { FFA_COLORS, MODES, NAMES, TEAM_COLORS } from './config.js';
import { Graphics } from './graphics.js';
import { Hud, hex } from './hud.js';
import { Sfx } from './audio.js';
import { StrokeSet } from './strokeSet.js';
import { buildArena, disposeArena } from './arena.js';
import { DrawPhase } from './drawPhase.js';
import { FightPhase } from './fight.js';
import { introHtml } from './intro.js';
import { Tutorial } from './tutorial.js';

// Game flow: intro -> menu (live attract map) -> 60 s draw phase -> fight on the drawn map -> results.
// The tutorial runs the same draw and fight phases with a checklist director on top.

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem('dtm-settings') || '{}');
        return s && typeof s === 'object' ? s : {};
    } catch {
        return {};
    }
}

class Game {
    constructor() {
        this.gfx = new Graphics(document.getElementById('game'));
        this.hud = new Hud(document.getElementById('ui'));
        this.sfx = new Sfx();
        this.strokes = new StrokeSet(this.gfx.scene);
        this.settings = {
            sensitivity: 1,
            aimMode: 'hold',
            tutorialDone: false,
            ...loadSettings(),
        };
        if (this.settings.aimMode !== 'toggle') this.settings.aimMode = 'hold';
        this.phase = null;
        this.arena = null;
        this.time = 0;
        this.maxDt = 0.1;
        this.last = performance.now();
        this.tutorial = null;
        this.showIntro();
        // dev shortcut: ?quick=duel4 jumps into a match with a 3 s draw phase, ?quick=tutorial into the tutorial
        const quick = import.meta.env.DEV && new URLSearchParams(location.search).get('quick');
        if (quick === 'tutorial') {
            this.startTutorial();
        } else if (quick && MODES[quick]) {
            this.startMatch(quick);
            this.phase.time = 3;
        }
        requestAnimationFrame((t) => this.frame(t));
        window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    }

    saveSettings() {
        // storage can be full or blocked (private windows); settings then last for the session
        try {
            localStorage.setItem('dtm-settings', JSON.stringify(this.settings));
        } catch {}
    }

    setupMatch(modeId, keepMap = false) {
        this.endTutorial();
        const mode = MODES[modeId];
        const sameArena = this.mode?.id === modeId && this.arena;
        this.mode = mode;
        this.teamColors = mode.layout === 'duel' ? TEAM_COLORS : FFA_COLORS.slice(0, mode.teamCount);
        if (!keepMap || !sameArena) {
            this.strokes.clear();
            if (this.arena) {
                this.gfx.scene.remove(this.arena.group);
                disposeArena(this.arena);
            }
            this.arena = buildArena(mode, this.teamColors);
            this.gfx.scene.add(this.arena.group);
        }
        this.strokes.setTeams(this.teamColors);
        this.strokes.setFightLook(0);

        const roster = [];
        if (mode.layout === 'duel') {
            for (let team = 0; team < 2; team++) {
                const names = team === 0 ? NAMES.team0 : NAMES.team1;
                const dummies = team === 1 && mode.dummies;
                for (let i = 0; i < (dummies || mode.perTeam); i++) {
                    roster.push({
                        name: dummies ? 'DUMMY' : names[i],
                        team,
                        color: this.teamColors[team],
                        isPlayer: team === 0 && i === 0,
                        dummy: !!dummies,
                    });
                }
            }
        } else {
            for (let i = 0; i < mode.teamCount; i++) {
                roster.push({ name: NAMES.ffa[i], team: i, color: this.teamColors[i], isPlayer: i === 0 });
            }
        }
        for (const r of roster) {
            r.kills = 0;
            r.deaths = 0;
        }
        this.roster = roster;
        this.me = roster[0];
    }

    endPhase() {
        this.phase?.dispose?.();
        this.phase = null;
        this.hud.hidePanel();
        this.hud.panel.classList.remove('dim');
        this.hud.showFight(false);
        this.hud.clearFeed();
        this.hud.hideTop();
        this.hud.clearCursors();
    }

    // Title screen on every start; bots draw an arena in the background.
    showIntro() {
        this.endPhase();
        this.state = 'intro';
        this.setupMatch('duel4');
        this.phase = new DrawPhase(this, { attract: true, spin: 0.1 });
        this.hud.showPanel(introHtml(this.settings.tutorialDone), {
            tutorial: () => this.startTutorial(),
            play: () => this.showMenu(),
        });
    }

    showMenu() {
        // coming from the intro, keep its orbiting background going
        if (this.state === 'intro') {
            this.hud.hidePanel();
        } else {
            this.endPhase();
            this.setupMatch('duel4');
            this.phase = new DrawPhase(this, { attract: true });
        }
        this.state = 'menu';
        this.hud.showPanel(
            `<div class="kicker">AN FPS WHERE</div>
             <div class="title">YOU DRAW THE MAP</div>
             <div class="sub">60 seconds to draw the arena with your team. Then fight on it.</div>
             <div class="modes">
               <button class="btn primary" data-act="play" data-mode="duel4">
                 <b>4 VS 4</b><span>team deathmatch</span>
               </button>
               <button class="btn" data-act="play" data-mode="duel10">
                 <b>10 VS 10</b><span>bigger. louder.</span>
               </button>
               <button class="btn" data-act="play" data-mode="ffa">
                 <b>FREE FOR ALL</b><span>8 artists, 1 winner</span>
               </button>
             </div>
             <div class="row-btns small">
               <button class="btn" data-act="tutorial"><b>TUTORIAL</b><span>learn the basics</span></button>
               <button class="btn" data-act="intro"><b>HOW TO PLAY</b><span>title screen</span></button>
             </div>
             <div class="controls">
               <div><b>DRAW</b>left-drag to draw · 1/2/3 tools</div>
               <div><b>VIEW</b>right-drag / A D rotate · wheel zoom</div>
               <div><b>FIGHT</b>WASD · mouse · LMB fire · RMB aim</div>
               <div><b>MOVE</b>space jump · double-jump · hold to glide</div>
             </div>
             <div class="credit">inspired by @bonkbureau — "an fps where you draw the map"</div>`,
            {
                play: (d) => this.startMatch(d.mode),
                tutorial: () => this.startTutorial(),
                intro: () => this.showIntro(),
            },
        );
    }

    startTutorial() {
        this.sfx.unlock();
        this.endPhase();
        this.setupMatch('tutorial');
        this.state = 'draw';
        this.tutorial = new Tutorial(this);
        this.phase = new DrawPhase(this, {
            duration: Infinity,
            bots: false,
            canReady: () => this.tutorial?.readyAllowed() ?? true,
        });
    }

    // The director outlives a single phase, so endPhase() leaves it alone; this ends it.
    endTutorial() {
        this.tutorial?.dispose();
        this.tutorial = null;
    }

    finishTutorial() {
        this.endTutorial();
        this.settings.tutorialDone = true;
        this.saveSettings();
        this.endPhase();
        this.state = 'tutorial-done';
        this.hud.showPanel(
            `<div class="kicker">TUTORIAL</div>
             <div class="title">COMPLETE</div>
             <div class="sub">You know the basics. Draw smart, fight hard.</div>
             <div class="row-btns">
               <button class="btn primary" data-act="play"><b>PLAY</b><span>pick a mode</span></button>
               <button class="btn" data-act="intro"><b>TITLE</b><span>back to the intro</span></button>
             </div>`,
            { play: () => this.showMenu(), intro: () => this.showIntro() },
        );
        this.hud.panel.classList.add('dim');
        this.phase = new DrawPhase(this, { attract: true, bots: false });
        this.strokes.setFightLook(1);
    }

    startMatch(modeId, keepMap = false) {
        this.sfx.unlock();
        this.endPhase();
        this.setupMatch(modeId, keepMap);
        this.state = 'draw';
        this.phase = new DrawPhase(this);
    }

    startFight() {
        this.endPhase();
        this.state = 'fight';
        this.hud.showFight(true);
        this.phase = new FightPhase(this, { tutorial: !!this.tutorial });
    }

    showResults(summary) {
        this.endPhase();
        this.state = 'results';
        // winner is -1 when the top score is shared; that is a draw only for the teams sharing it
        const tie = summary.winner < 0;
        const draw = tie && summary.scores[this.me.team] === Math.max(...summary.scores);
        const won = summary.winner === this.me.team;
        const rows = (list) =>
            list
                .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
                .map(
                    (r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td style="color:${hex(r.color)}">${r.name}</td>
                            <td class="num">${r.kills}</td><td class="num">${r.deaths}</td></tr>`,
                )
                .join('');
        const head = '<tr><th>PLAYER</th><th class="num">K</th><th class="num">D</th></tr>';
        let boards;
        let score;
        if (this.mode.layout === 'duel') {
            boards = [0, 1]
                .map((t) => `<table>${head}${rows(summary.fighters.filter((f) => f.team === t))}</table>`)
                .join('');
            score = `<span style="color:${hex(this.teamColors[0])}">${summary.scores[0]}</span>
                     <span style="opacity:.5;margin:0 14px">·</span>
                     <span style="color:${hex(this.teamColors[1])}">${summary.scores[1]}</span>`;
        } else {
            boards = `<table>${head}${rows([...summary.fighters])}</table>`;
            const top = Math.max(...summary.scores);
            const leaders = summary.fighters.filter((f) => summary.scores[f.team] === top);
            const names = leaders.map((f) => `<span style="color:${hex(f.color)}">${f.name}</span>`).join(' &amp; ');
            score = `${names} ${tie ? 'TIE' : 'WINS'}`;
        }
        this.hud.showPanel(
            `<div class="kicker">${draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}</div>
             <div class="title" style="font-size:clamp(40px,5vw,80px);color:#fff">${score}</div>
             <div class="board">${boards}</div>
             <div class="row-btns">
               <button class="btn primary" data-act="grow"><b>KEEP DRAWING</b><span>add to this map</span></button>
               <button class="btn" data-act="fresh"><b>NEW MAP</b><span>start from scratch</span></button>
               <button class="btn" data-act="menu"><b>MENU</b><span>change mode</span></button>
             </div>`,
            {
                grow: () => this.startMatch(this.mode.id, true),
                fresh: () => this.startMatch(this.mode.id, false),
                menu: () => this.showMenu(),
            },
        );
        this.hud.panel.classList.add('dim');
        // slow orbit over the map behind the results
        this.phase = new DrawPhase(this, { attract: true, bots: false });
        this.strokes.setFightLook(1);
    }

    frame(now) {
        // schedule first: an exception in one frame must never stop the loop
        requestAnimationFrame((t) => this.frame(t));
        const dt = Math.min(this.maxDt, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        try {
            if (this.phase) {
                this.phase.update(dt);
                if (this.phase.done) {
                    if (this.state === 'draw') this.startFight();
                    else if (this.state === 'fight') this.showResults(this.phase.summary());
                }
            }
            this.tutorial?.update(dt);
            this.hud.update(dt);
            this.gfx.adapt(dt);
            this.gfx.render(this.time);
        } catch (err) {
            console.error(err);
            this.hud.error(err?.message || String(err));
        }
    }
}

window.game = new Game();
