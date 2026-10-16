// Aim-down-sights input, kept pure so it can be tested without a browser.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

// hold: aim while the button is down; toggle: each press flips it.
export function aimReducer(aiming, action, mode = 'hold') {
    if (action === 'reset') return false;
    if (mode === 'toggle') return action === 'press' ? !aiming : aiming;
    return action === 'press';
}

// Which game action a mouse press means. On macOS, Ctrl+click is the system's right click.
export function mouseAction(e, mac = IS_MAC) {
    if (e.button === 2) return 'aim';
    if (e.button === 0) return mac && e.ctrlKey ? 'aim' : 'fire';
    return null;
}

// Hybrid aiming with a latch. State: { aiming, latched, src, downAt }.
// - toggle mode, or Ctrl+click (one-button Macs, where the same button must then fire): each press flips
// - hold mode: aim while the right button is down; a quick tap (two-finger trackpad tap) latches the
//   aim, and the next press ends it
export const IDLE_AIM = { aiming: false, latched: false, src: null, downAt: 0 };

export function aimPress(state, { src, mode, t }) {
    if (src === 'ctrl' || mode === 'toggle') return { aiming: !state.aiming, latched: false, src: null, downAt: t };
    if (state.latched) return { ...IDLE_AIM, downAt: t };
    return { aiming: true, latched: false, src, downAt: t };
}

export function aimRelease(state, { t, tap = 220 }) {
    // presses that toggled or ended a latch have nothing to release
    if (!state.src) return state;
    if (t - state.downAt < tap) return { ...state, latched: true, src: null };
    return { ...IDLE_AIM, downAt: state.downAt };
}
