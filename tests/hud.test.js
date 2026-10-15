import { describe, expect, it } from 'vitest';
import { Hud } from '../src/hud.js';

describe('Hud.panelClickAllowed', () => {
    const allowed = (shownAgo, detail = 1) =>
        Hud.prototype.panelClickAllowed.call({ panelShownAt: performance.now() - shownAgo }, { detail });

    it('accepts a single click on a panel that has been up a moment', () => {
        expect(allowed(500)).toBe(true);
        // keyboard-activated clicks have detail 0
        expect(allowed(500, 0)).toBe(true);
    });

    it('ignores clicks right after the panel appears and the second click of a double-click', () => {
        expect(allowed(50)).toBe(false);
        expect(allowed(500, 2)).toBe(false);
    });
});
