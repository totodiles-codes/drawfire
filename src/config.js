// Shared tuning values and palettes.

export const TEAM_COLORS = [0xe2683a, 0x7062e6];
export const FFA_COLORS = [0xe2683a, 0x7062e6, 0x5cc46a, 0xe56fb0, 0xe6c03c, 0x40badb, 0xe0534f, 0xa8de62];
export const SURFACE_WHITE = 0xe8e7e2;

export const MODES = {
    duel4: {
        id: 'duel4',
        label: '4 VS 4',
        layout: 'duel',
        teamCount: 2,
        perTeam: 4,
        scoreLimit: 30,
        length: 74,
        baseSize: 14,
    },
    duel10: {
        id: 'duel10',
        label: '10 VS 10',
        layout: 'duel',
        teamCount: 2,
        perTeam: 10,
        scoreLimit: 70,
        length: 100,
        baseSize: 18,
    },
    // guided practice: the player plus target dummies that never shoot; not listed in the menu
    tutorial: {
        id: 'tutorial',
        label: 'TUTORIAL',
        layout: 'duel',
        teamCount: 2,
        perTeam: 1,
        dummies: 3,
        scoreLimit: Infinity,
        length: 74,
        baseSize: 14,
    },
    ffa: {
        id: 'ffa',
        label: 'FREE FOR ALL',
        layout: 'radial',
        teamCount: 8,
        perTeam: 1,
        scoreLimit: 15,
        radius: 42,
    },
};

export const NAMES = {
    team0: ['YOU', 'kaz', 'milo_', 'rio', 'juno', 'ash', 'tek', 'bo', 'vex', 'lu'],
    team1: ['NOVA', 'pix', 'kai', 'zed', 'ori', 'sly', 'quin', 'dex', 'rue', 'fen'],
    ffa: ['YOU', 'NOVA', 'kaz', 'pix', 'milo_', 'kai', 'rio', 'zed'],
};

export const TIMING = {
    draw: 60,
    fight: 240,
    respawn: 3,
    flight: 2.0,
};

export const STROKE = {
    ribbonWidth: 3.0,
    wallHeight: 2.8,
    thickness: 0.42,
    slabThickness: 0.6,
    spacing: 0.45,
    minPointGap: 0.35,
    maxLength: 70,
    ink: 340,
    // GROUND paths: flat walkable strips whose top sits just above the surface they start on
    pathWidth: 2.6,
    pathThickness: 0.4,
    groundLift: 0.06,
};

export const PHYS = {
    gravity: 26,
    radius: 0.4,
    height: 1.8,
    eye: 1.6,
    walk: 9,
    sprint: 12.5,
    groundAccel: 90,
    airAccel: 28,
    jump: 9.4,
    doubleJump: 8.8,
    killY: -45,
};

// Glide jet: after the double jump, holding Space brakes the fall. fuel = seconds of burn,
// fall = glide sink speed (m/s), brake = max upward correction (m/s^2), refill = seconds to refill.
export const JET = { fuel: 1.4, fall: 2.8, brake: 70, refill: 1.2 };

// Aim down sights: target FOVs, movement multiplier while aiming, blend rate, the ADS amount at which
// the rifle scope overlay appears, and the ADS amount a rifle hit needs to count as "aimed".
export const AIM = { rifleFov: 30, lobberFov: 60, move: 0.6, rate: 16, scopeAt: 0.8, hitAds: 0.6 };

export const WEAPONS = {
    rifle: {
        id: 'rifle',
        label: 'LASER RIFLE',
        interval: 0.13,
        damage: 22,
        headMult: 2,
        mag: 24,
        reload: 1.4,
        spread: 0.006,
        range: 260,
    },
    launcher: {
        id: 'launcher',
        label: 'PLASMA LOBBER',
        interval: 0.75,
        damage: 95,
        radius: 4.8,
        mag: 4,
        reload: 1.9,
        speed: 42,
        gravity: 16,
        knockback: 17,
    },
};

export const BOT = {
    damage: 9,
    interval: 0.3,
    spread: 0.05,
    reaction: 0.45,
    turnRate: 7,
    sight: 95,
};
