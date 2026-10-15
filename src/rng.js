// Small seeded PRNG (mulberry32) with helpers.
export class Rng {
    constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
        this.s = seed >>> 0;
    }

    next() {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(a, b) {
        return a + (b - a) * this.next();
    }

    int(a, b) {
        return Math.floor(this.range(a, b + 1));
    }

    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }

    sign() {
        return this.next() < 0.5 ? -1 : 1;
    }

    chance(p) {
        return this.next() < p;
    }

    weighted(entries) {
        const total = entries.reduce((s, e) => s + e[0], 0);
        let r = this.next() * total;
        for (const e of entries) {
            r -= e[0];
            if (r <= 0) return e[1];
        }
        return entries[entries.length - 1][1];
    }
}
