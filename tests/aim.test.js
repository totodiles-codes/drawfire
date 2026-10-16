import { describe, expect, it } from 'vitest';
import { IDLE_AIM, aimPress, aimReducer, aimRelease, mouseAction } from '../src/aim.js';

describe('aimReducer', () => {
    it('hold: aims while pressed', () => {
        expect(aimReducer(false, 'press', 'hold')).toBe(true);
        expect(aimReducer(true, 'release', 'hold')).toBe(false);
        expect(aimReducer(true, 'reset', 'hold')).toBe(false);
    });

    it('toggle: each press flips, releases are ignored', () => {
        let a = aimReducer(false, 'press', 'toggle');
        expect(a).toBe(true);
        a = aimReducer(a, 'release', 'toggle');
        expect(a).toBe(true);
        a = aimReducer(a, 'press', 'toggle');
        expect(a).toBe(false);
        expect(aimReducer(true, 'reset', 'toggle')).toBe(false);
    });
});

describe('mouseAction', () => {
    it('maps buttons the standard way', () => {
        expect(mouseAction({ button: 0, ctrlKey: false }, false)).toBe('fire');
        expect(mouseAction({ button: 2, ctrlKey: false }, false)).toBe('aim');
        expect(mouseAction({ button: 1, ctrlKey: false }, false)).toBe(null);
    });

    it('treats Ctrl+click as the right click only on a Mac', () => {
        expect(mouseAction({ button: 0, ctrlKey: true }, true)).toBe('aim');
        expect(mouseAction({ button: 0, ctrlKey: true }, false)).toBe('fire');
        expect(mouseAction({ button: 2, ctrlKey: true }, true)).toBe('aim');
    });
});

describe('aimPress / aimRelease', () => {
    const press = (st, src, mode, t) => aimPress(st, { src, mode, t });
    const release = (st, t) => aimRelease(st, { t });

    it('hold: a long press aims only while held', () => {
        let st = press(IDLE_AIM, 'rmb', 'hold', 0);
        expect(st.aiming).toBe(true);
        st = release(st, 600);
        expect(st.aiming).toBe(false);
    });

    it('hold: a quick tap latches until the next press', () => {
        let st = release(press(IDLE_AIM, 'rmb', 'hold', 0), 90);
        expect(st.aiming).toBe(true);
        st = press(st, 'rmb', 'hold', 2000);
        expect(st.aiming).toBe(false);
        // the release of that ending press must not start aiming again
        st = release(st, 2050);
        expect(st.aiming).toBe(false);
    });

    it('Ctrl+click always toggles, so the same button can fire while aiming', () => {
        let st = press(IDLE_AIM, 'ctrl', 'hold', 0);
        expect(st.aiming).toBe(true);
        st = release(st, 1000);
        expect(st.aiming).toBe(true);
        st = press(st, 'ctrl', 'hold', 2000);
        expect(st.aiming).toBe(false);
    });

    it('toggle mode flips on press and ignores releases', () => {
        let st = press(IDLE_AIM, 'rmb', 'toggle', 0);
        st = release(st, 900);
        expect(st.aiming).toBe(true);
        st = release(press(st, 'rmb', 'toggle', 1000), 1050);
        expect(st.aiming).toBe(false);
    });

    it('a lost release (seen later via the button bits) ends a held aim', () => {
        const st = release(press(IDLE_AIM, 'rmb', 'hold', 0), Infinity);
        expect(st.aiming).toBe(false);
    });
});
