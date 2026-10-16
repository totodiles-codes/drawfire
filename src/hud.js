// DOM overlay: timers, captions, cursors, draw toolbar, fight HUD and full-screen panels.

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}

const CURSOR_SVG = (color, id) => `
<svg width="30" height="34" viewBox="0 0 30 34">
  <defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/>
    <stop offset="0.45" stop-color="${color}"/>
    <stop offset="1" stop-color="${color}"/>
  </linearGradient></defs>
  <path d="M3 2.5 L3 27 L9.6 21 L14.2 31 L18.6 29 L14 19.2 L23 19.2 Z"
        fill="url(#g${id})" stroke="rgba(255,255,255,0.92)" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`;

const KILL_ICON = `<svg viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="6.2" fill="none"
 stroke="currentColor" stroke-width="2"/><path d="M10 1v5M10 14v5M1 10h5M14 10h5" stroke="currentColor"
 stroke-width="2"/></svg>`;
const BLAST_ICON = `<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 1l2 5 5-2-2 5 4 2-5 2 2 5-5-2-1
 5-2-5-5 2 2-5-4-2 5-2-2-5 5 2z" fill="currentColor"/></svg>`;
const FALL_ICON = `<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 2v13M4 10l6 7 6-7" fill="none"
 stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let cursorId = 0;

export class Hud {
    constructor(root) {
        this.root = root;
        this.root.innerHTML = '';

        this.cursorLayer = el('div', 'cursor-layer');
        this.top = el('div', 'hud-top hidden');
        this.top.innerHTML =
            `<div class="hud-header"></div><div class="hud-timer"></div><div class="hud-scores"></div>`;
        this.captionEl = el('div', 'caption');
        this.subtitleEl = el('div', 'subtitle hidden');
        this.fight = el('div', 'fight-hud hidden');
        this.fight.innerHTML = `
            <div class="crosshair"></div>
            <div class="hitmarker"></div>
            <div class="killfeed"></div>
            <div class="health"><div class="hp-num">100</div><div class="hp-track"><div class="hp-fill"></div></div>
                <div class="jet"><div class="jet-fill"></div></div></div>
            <div class="weapon"><div class="wp-ammo"><b>24</b><span>/ 24</span></div>
                <div class="wp-name">LASER RIFLE</div>
                <div class="wp-slots"><span data-w="rifle">1</span><span data-w="launcher">2</span></div></div>
            <div class="center-msg"></div>
            <div class="mouse-hint"></div>`;
        this.scope = el(
            'div',
            'scope hidden',
            '<div class="scope-ring"></div><div class="scope-h"></div>' +
                '<div class="scope-v"></div><div class="scope-dot"></div>',
        );
        this.vignette = el('div', 'vignette');
        this.drawbar = el('div', 'drawbar hidden');
        this.drawhint = el('div', 'drawhint hidden');
        this.panel = el('div', 'panel hidden');
        // tutorial checklist; after the panel so its buttons stay clickable above the pause menu
        this.guide = el('div', 'guide hidden');
        this.root.append(this.cursorLayer, this.scope, this.vignette, this.top, this.captionEl, this.subtitleEl,
            this.fight, this.drawbar, this.drawhint, this.panel, this.guide);

        this.q = (sel) => this.fight.querySelector(sel);
        this.feedItems = [];
        this.captionTimer = 0;
        this.hitTimer = 0;
        this.vignetteLevel = 0;
    }

    // ---------- top bar ----------
    setTop({ header, timer, hot = false, scores = null }) {
        this.top.classList.remove('hidden');
        const [h, t, s] = this.top.children;
        if (h.textContent !== header) h.textContent = header;
        if (t.textContent !== timer) t.textContent = timer;
        t.classList.toggle('hot', hot);
        if (scores) {
            const html = scores
                .map((x) => `<span class="sc${x.mine ? ' mine' : ''}" style="color:${hex(x.color)}">${x.value}</span>`)
                .join('<span class="dot">·</span>');
            if (s.innerHTML !== html) s.innerHTML = html;
            s.classList.remove('hidden');
        } else {
            s.classList.add('hidden');
        }
    }

    hideTop() {
        this.top.classList.add('hidden');
    }

    // ---------- trailer-style captions ----------
    caption(line1, line2 = '', duration = 2.2) {
        const l2 = line2 ? `<div class="hl">${line2}</div>` : '';
        this.captionEl.innerHTML = `<div class="cap-inner"><div>${line1}</div>${l2}</div>`;
        this.captionEl.classList.remove('show');
        void this.captionEl.offsetWidth;
        this.captionEl.classList.add('show');
        this.captionTimer = duration;
    }

    subtitle(text) {
        if (!text) {
            this.subtitleEl.classList.add('hidden');
            return;
        }
        this.subtitleEl.textContent = text;
        this.subtitleEl.classList.remove('hidden');
    }

    // ---------- multiplayer-style cursors ----------
    createCursor(name, color, self = false) {
        const c = el('div', 'cursor' + (self ? ' self' : ''));
        c.innerHTML =
            CURSOR_SVG(hex(color), cursorId++) + `<div class="cursor-name" style="color:${hex(color)}">${name}</div>`;
        this.cursorLayer.appendChild(c);
        return {
            el: c,
            set(x, y, visible = true) {
                c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
                c.style.opacity = visible ? '1' : '0';
            },
            remove() {
                c.remove();
            },
        };
    }

    clearCursors() {
        this.cursorLayer.innerHTML = '';
    }

    // ---------- draw toolbar ----------
    showDrawBar(handlers) {
        this.drawbar.innerHTML = `
            <button class="tool" data-tool="ribbon"><span class="key">1</span>RIBBON</button>
            <button class="tool" data-tool="ground"><span class="key">2</span>GROUND</button>
            <button class="tool" data-tool="wall"><span class="key">3</span>WALL</button>
            <div class="ink"><div class="ink-label">INK</div>
                <div class="ink-track"><div class="ink-fill"></div></div></div>
            <button class="act" data-act="undo"><span class="key">Z</span>UNDO</button>
            <button class="act ready" data-act="ready"><span class="key">⏎</span>READY</button>`;
        this.drawbar.classList.remove('hidden');
        this.drawhint.classList.remove('hidden');
        this.drawbar.querySelectorAll('[data-tool]').forEach((b) => {
            b.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                handlers.onTool(b.dataset.tool);
            });
        });
        this.drawbar.querySelector('[data-act=undo]').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            handlers.onUndo();
        });
        this.drawbar.querySelector('[data-act=ready]').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            handlers.onReady();
        });
    }

    updateDrawBar({ tool, ink, ready, color, lift = null }) {
        this.drawbar.querySelectorAll('[data-tool]').forEach((b) => {
            b.classList.toggle('active', b.dataset.tool === tool);
        });
        const fill = this.drawbar.querySelector('.ink-fill');
        fill.style.width = `${Math.max(0, Math.min(1, ink)) * 100}%`;
        fill.style.background = hex(color);
        this.drawbar.querySelector('.ready').classList.toggle('on', ready);
        const hints = {
            ribbon: '<b>RIBBON</b> draws in the air facing you — flat lines become floors, slopes become ramps',
            ground: '<b>GROUND</b> paints walkable paths on the surface you start on — close a loop for a platform',
            wall: '<b>WALL</b> draws on the floor — lines become cover walls, loops become rings',
        };
        const height =
            lift === null
                ? ''
                : ` · Q E height <b class="${lift ? 'lift' : ''}">${lift > 0 ? '+' : ''}${lift.toFixed(1)} m</b>`;
        const html =
            `<div>${hints[tool]}</div>` +
            `<div class="keys">RMB-drag / A D rotate · W S tilt · wheel zoom${height}</div>`;
        if (this.drawhint.innerHTML !== html) this.drawhint.innerHTML = html;
    }

    hideDrawBar() {
        this.drawbar.classList.add('hidden');
        this.drawhint.classList.add('hidden');
    }

    // ---------- fight HUD ----------
    showFight(show) {
        this.fight.classList.toggle('hidden', !show);
        if (!show) {
            this.setScope(false);
            this.vignetteLevel = 0;
            this.vignette.style.opacity = '0';
        }
    }

    setHealth(hp) {
        const num = this.q('.hp-num');
        const v = Math.max(0, Math.ceil(hp));
        if (num.textContent !== String(v)) num.textContent = v;
        const fill = this.q('.hp-fill');
        fill.style.width = `${Math.max(0, hp)}%`;
        fill.classList.toggle('low', hp < 35);
    }

    setJet(frac, active) {
        const j = this.q('.jet');
        j.firstChild.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
        j.classList.toggle('on', active);
        j.classList.toggle('refill', !active && frac < 0.999);
        j.classList.toggle('empty', frac < 0.02);
    }

    setWeapon(id, label, ammo, mag, reloading) {
        const a = this.q('.wp-ammo');
        const html = reloading ? '<b class="rl">RELOADING</b>' : `<b>${ammo}</b><span>/ ${mag}</span>`;
        if (a.innerHTML !== html) a.innerHTML = html;
        const n = this.q('.wp-name');
        if (n.textContent !== label) n.textContent = label;
        this.fight.querySelectorAll('.wp-slots span').forEach((s) => s.classList.toggle('on', s.dataset.w === id));
    }

    setCrosshair(visible, aiming = false) {
        const c = this.q('.crosshair');
        c.style.opacity = visible ? '1' : '0';
        c.classList.toggle('ads', aiming);
    }

    hitmarker(kill = false, head = false) {
        const h = this.q('.hitmarker');
        h.classList.remove('show', 'kill', 'head');
        void h.offsetWidth;
        h.classList.add('show');
        if (kill) h.classList.add('kill');
        else if (head) h.classList.add('head');
    }

    damage(amount) {
        this.vignetteLevel = Math.min(1, this.vignetteLevel + amount / 45);
    }

    setMouseHint(html) {
        const h = this.q('.mouse-hint');
        if (h.innerHTML !== html) h.innerHTML = html;
        h.style.opacity = html ? '1' : '0';
    }

    // Small banner for unexpected runtime errors so a broken frame is visible instead of a silent freeze.
    error(message) {
        if (!this.errorEl) {
            this.errorEl = el('div', 'error-banner');
            this.root.appendChild(this.errorEl);
        }
        this.errorEl.textContent = `Something went wrong: ${message}`;
        this.errorEl.classList.add('show');
        clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => this.errorEl.classList.remove('show'), 6000);
    }

    setScope(on) {
        this.scope.classList.toggle('hidden', !on);
    }

    centerMsg(html) {
        const c = this.q('.center-msg');
        if (c.innerHTML !== html) c.innerHTML = html;
        c.style.opacity = html ? '1' : '0';
    }

    killfeed(killer, victim, weapon) {
        const feed = this.q('.killfeed');
        const icon = weapon === 'launcher' ? BLAST_ICON : weapon === 'fall' ? FALL_ICON : KILL_ICON;
        const row = el('div', 'kf-row');
        const k = killer ? `<span style="color:${hex(killer.color)}">${killer.name}</span>` : '';
        const v = `<span style="color:${hex(victim.color)}">${victim.name}</span>`;
        row.innerHTML = `${k}<span class="kf-icon">${icon}</span>${v}`;
        if (killer?.isPlayer || victim.isPlayer) row.classList.add('mine');
        feed.prepend(row);
        this.feedItems.push({ row, t: 5 });
        while (feed.children.length > 6) feed.lastChild.remove();
    }

    clearFeed() {
        this.q('.killfeed').innerHTML = '';
        this.feedItems = [];
    }

    // ---------- tutorial checklist ----------
    showGuide(texts, { onSkipStep, onSkip }) {
        this.guide.innerHTML = `<div class="guide-head">TUTORIAL</div>
            <ol>${texts.map((t) => `<li>${t}</li>`).join('')}</ol>
            <div class="guide-btns"><button data-g="step">SKIP STEP</button>
                <button data-g="all">SKIP TUTORIAL</button></div>`;
        this.guide.classList.remove('hidden');
        const bind = (sel, fn) =>
            this.guide.querySelector(sel).addEventListener('click', (e) => {
                // keep the click away from the deploy panel's click-anywhere
                e.stopPropagation();
                e.currentTarget.blur();
                fn();
            });
        bind('[data-g=step]', onSkipStep);
        bind('[data-g=all]', onSkip);
    }

    // Only the last finished step, the current one and the next three are shown.
    setGuide(index) {
        const items = this.guide.querySelectorAll('li');
        items.forEach((li, i) => {
            li.classList.toggle('done', i < index);
            li.classList.toggle('current', i === index);
            li.classList.toggle('far', i < index - 1 || i > index + 3);
        });
        const head = this.guide.querySelector('.guide-head');
        if (head) head.textContent = `TUTORIAL · ${Math.min(index, items.length)}/${items.length}`;
    }

    hideGuide() {
        this.guide.classList.add('hidden');
        this.guide.innerHTML = '';
    }

    // ---------- panels ----------
    showPanel(html, handlers = {}) {
        this.panel.innerHTML = html;
        this.panel.classList.remove('hidden');
        this.panelShownAt = performance.now();
        this.panel.querySelectorAll('[data-act]').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.panelClickAllowed(e)) return;
                handlers[b.dataset.act]?.(b.dataset, e);
            });
        });
        return this.panel;
    }

    // A panel can pop up under a player who is still clicking (firing, double-clicking): ignore those clicks.
    panelClickAllowed(e) {
        return e.detail <= 1 && performance.now() - this.panelShownAt >= 300;
    }

    hidePanel() {
        this.panel.classList.add('hidden');
        this.panel.innerHTML = '';
    }

    update(dt) {
        if (this.captionTimer > 0) {
            this.captionTimer -= dt;
            if (this.captionTimer <= 0) this.captionEl.classList.remove('show');
        }
        for (const f of this.feedItems) {
            f.t -= dt;
            if (f.t < 0.6) f.row.style.opacity = String(Math.max(0, f.t / 0.6));
            if (f.t <= 0) f.row.remove();
        }
        this.feedItems = this.feedItems.filter((f) => f.t > 0);
        if (this.vignetteLevel > 0) {
            this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 0.9);
            this.vignette.style.opacity = this.vignetteLevel.toFixed(3);
        }
    }
}

export { hex };
