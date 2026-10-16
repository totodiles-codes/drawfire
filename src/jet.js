import { JET, PHYS } from './config.js';

// The glide jet, kept pure so it can be tested on its own.

export function createJet() {
    return { fuel: JET.fuel, active: false };
}

// Returns the new vertical speed. While held (and armed by the double jump) the jet brakes a fall
// to -JET.fall; it never adds height. vy is the speed before world.move applies this frame's gravity.
export function jetStep(jet, { hold, armed, onGround, vy, dt, gravity = PHYS.gravity }) {
    if (onGround) {
        jet.active = false;
        jet.fuel = Math.min(JET.fuel, jet.fuel + (JET.fuel / JET.refill) * dt);
        return vy;
    }
    // world.move subtracts gravity * dt afterwards, so aim for -fall after that
    jet.active = hold && armed && jet.fuel > 0 && vy - gravity * dt < -JET.fall;
    if (!jet.active) return vy;
    jet.fuel = Math.max(0, jet.fuel - dt);
    return Math.min(-JET.fall + gravity * dt, vy + (gravity + JET.brake) * dt);
}
