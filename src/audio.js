// Tiny WebAudio synth for all game sounds - no audio assets needed.

export class Sfx {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.noiseBuf = null;
        this.scribble = null;
        this.volume = 0.6;
    }

    unlock() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    get ready() {
        return !!this.ctx && this.ctx.state === 'running';
    }

    out(gain, pan = 0) {
        const g = this.ctx.createGain();
        g.gain.value = Number.isFinite(gain) ? gain : 0;
        if (pan && Number.isFinite(pan) && this.ctx.createStereoPanner) {
            const p = this.ctx.createStereoPanner();
            p.pan.value = Math.max(-1, Math.min(1, pan));
            g.connect(p).connect(this.master);
        } else {
            g.connect(this.master);
        }
        return g;
    }

    tone({ type = 'sine', from, to, dur, gain = 0.2, pan = 0, delay = 0 }) {
        // WebAudio throws on non-finite values; never let a sound effect break a frame
        if (!this.ready || !Number.isFinite(from) || !(gain > 0) || (to !== undefined && !Number.isFinite(to))) return;
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        const g = this.out(0, pan);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    }

    noise({ dur, gain = 0.2, freq = 1200, q = 0.8, type = 'bandpass', pan = 0, sweepTo }) {
        if (!this.ready || !(gain > 0) || !Number.isFinite(freq)) return;
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
        f.Q.value = q;
        const g = this.out(0, pan);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.05);
    }

    // distance/pan helpers for sounds in the world
    spatial(dist, pan) {
        if (!Number.isFinite(dist)) return { gain: 0, pan: 0 };
        const gain = Math.max(0, 1 - dist / 90);
        return { gain: gain * gain, pan: Number.isFinite(pan) ? pan : 0 };
    }

    laser(own = true, dist = 0, pan = 0) {
        const s = own ? { gain: 1, pan: 0 } : this.spatial(dist, pan);
        if (s.gain < 0.02) return;
        const base = own ? 1500 : 1100 + Math.random() * 300;
        this.tone({ type: 'sawtooth', from: base, to: 180, dur: 0.16, gain: 0.07 * s.gain, pan: s.pan });
        this.tone({ type: 'square', from: base * 0.5, to: 90, dur: 0.12, gain: 0.04 * s.gain, pan: s.pan });
        this.noise({ dur: 0.06, gain: 0.08 * s.gain, freq: 4000, q: 0.6, pan: s.pan });
    }

    lob() {
        this.tone({ type: 'sine', from: 180, to: 520, dur: 0.22, gain: 0.22 });
        this.noise({ dur: 0.2, gain: 0.12, freq: 600, q: 0.7, sweepTo: 2400 });
    }

    explosion(dist = 0, pan = 0) {
        const s = this.spatial(dist * 0.6, pan);
        if (s.gain < 0.02) return;
        this.noise({ dur: 0.9, gain: 0.55 * s.gain, freq: 900, q: 0.5, type: 'lowpass', sweepTo: 60, pan: s.pan });
        this.tone({ type: 'sine', from: 120, to: 35, dur: 0.6, gain: 0.35 * s.gain, pan: s.pan });
    }

    hit(head = false) {
        this.tone({ type: 'triangle', from: head ? 2400 : 1800, to: head ? 2000 : 1500, dur: 0.07, gain: 0.16 });
    }

    kill() {
        this.tone({ type: 'triangle', from: 880, dur: 0.12, gain: 0.18 });
        this.tone({ type: 'triangle', from: 1320, dur: 0.22, gain: 0.18, delay: 0.08 });
    }

    hurt() {
        this.noise({ dur: 0.18, gain: 0.25, freq: 300, q: 1.2, type: 'lowpass' });
        this.tone({ type: 'square', from: 140, to: 70, dur: 0.15, gain: 0.07 });
    }

    death() {
        this.tone({ type: 'sawtooth', from: 400, to: 60, dur: 0.7, gain: 0.12 });
    }

    jump() {
        this.noise({ dur: 0.18, gain: 0.07, freq: 500, q: 0.8, sweepTo: 1500 });
    }

    reload() {
        this.tone({ type: 'square', from: 300, dur: 0.05, gain: 0.05 });
        this.tone({ type: 'square', from: 450, dur: 0.05, gain: 0.05, delay: 0.22 });
    }

    click() {
        this.tone({ type: 'triangle', from: 700, to: 500, dur: 0.06, gain: 0.12 });
    }

    beep(high = false) {
        this.tone({ type: 'sine', from: high ? 1320 : 660, dur: high ? 0.4 : 0.15, gain: 0.2 });
    }

    pop() {
        this.tone({ type: 'sine', from: 300, to: 900, dur: 0.12, gain: 0.15 });
    }

    whoosh() {
        this.noise({ dur: 1.4, gain: 0.25, freq: 300, q: 0.6, sweepTo: 2600 });
    }

    // Lazily built looping noise voice (noise -> filter -> gain) for continuous sounds.
    noiseLoop(key, type, freq, q) {
        this.loops ??= {};
        if (!this.loops[key]) {
            const src = this.ctx.createBufferSource();
            src.buffer = this.noiseBuf;
            src.loop = true;
            const f = this.ctx.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            const g = this.ctx.createGain();
            g.gain.value = 0;
            src.connect(f).connect(g).connect(this.master);
            src.start();
            this.loops[key] = { src, f, g };
        }
        return this.loops[key];
    }

    // continuous pencil scribble while drawing; level 0..1
    setScribble(level) {
        if (!this.ready) return;
        const l = this.noiseLoop('scribble', 'bandpass', 2600, 1.2);
        const t = this.ctx.currentTime;
        l.g.gain.setTargetAtTime(level * 0.09, t, 0.04);
        l.f.frequency.setTargetAtTime(2000 + level * 2500, t, 0.05);
    }

    // jet hiss while gliding; level 0..1
    setJet(level) {
        if (!this.ready || (!level && !this.loops?.jet)) return;
        const l = this.noiseLoop('jet', 'lowpass', 600, 0.7);
        l.g.gain.setTargetAtTime(level * 0.14, this.ctx.currentTime, 0.05);
    }
}
