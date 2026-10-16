import * as THREE from 'three';

// Little astronaut-style figure in a team colour. Origin at the feet, facing -Z.

const geoCache = {};
function geo(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
}

const visorMat = new THREE.MeshStandardMaterial({ color: 0x15161f, roughness: 0.15, metalness: 0.4 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.45 });

function limb(radius, length, mat) {
    const g = geo(`limb${radius}${length}`, () => {
        const c = new THREE.CapsuleGeometry(radius, length, 4, 10);
        c.translate(0, -length / 2, 0);
        return c;
    });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
}

export class Astronaut {
    constructor(color) {
        const base = new THREE.Color(color);
        this.mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.55 });
        this.lightMat = new THREE.MeshStandardMaterial({
            color: base.clone().lerp(new THREE.Color(0xffffff), 0.18),
            roughness: 0.5,
        });

        this.root = new THREE.Group();
        this.body = new THREE.Group();
        this.root.add(this.body);

        const torso = new THREE.Mesh(geo('torso', () => new THREE.CapsuleGeometry(0.27, 0.42, 4, 12)), this.mat);
        torso.position.y = 1.08;
        const pack = new THREE.Mesh(geo('pack', () => new THREE.BoxGeometry(0.42, 0.48, 0.2)), this.lightMat);
        pack.position.set(0, 1.12, 0.27);
        const head = new THREE.Mesh(geo('head', () => new THREE.SphereGeometry(0.27, 20, 14)), this.lightMat);
        head.position.y = 1.56;
        const visor = new THREE.Mesh(geo('visor', () => new THREE.SphereGeometry(0.2, 20, 12)), visorMat);
        visor.scale.set(1, 0.72, 0.6);
        visor.position.set(0, 1.58, -0.15);
        for (const m of [torso, pack, head, visor]) m.castShadow = true;
        this.body.add(torso, pack, head, visor);

        this.legL = limb(0.11, 0.5, this.mat);
        this.legR = limb(0.11, 0.5, this.mat);
        this.legL.position.set(-0.13, 0.78, 0);
        this.legR.position.set(0.13, 0.78, 0);
        this.armL = limb(0.085, 0.42, this.mat);
        this.armR = limb(0.085, 0.42, this.mat);
        this.armL.position.set(-0.36, 1.36, 0);
        this.armR.position.set(0.36, 1.36, 0);
        const gun = new THREE.Mesh(geo('gun', () => new THREE.BoxGeometry(0.09, 0.12, 0.6)), gunMat);
        gun.position.set(0.2, 1.12, -0.38);
        gun.castShadow = true;
        this.gun = gun;
        this.body.add(this.legL, this.legR, this.armL, this.armR, gun);

        this.phase = Math.random() * 10;
        this.dead = false;
        this.spin = new THREE.Vector3();
    }

    // Geometries and the visor / gun materials are shared by every astronaut; only the colour pair is per figure.
    dispose() {
        this.mat.dispose();
        this.lightMat.dispose();
    }

    // speed: horizontal speed, air: airborne, pitch: aim pitch
    animate(dt, speed, air, pitch) {
        if (this.dead) return;
        const run = Math.min(1, speed / 9);
        this.phase += dt * (4 + speed * 1.2);
        const s = Math.sin(this.phase) * 0.9 * run;
        if (air) {
            this.legL.rotation.x = 0.6;
            this.legR.rotation.x = -0.3;
        } else {
            this.legL.rotation.x = s;
            this.legR.rotation.x = -s;
        }
        // arms hold the gun forward and follow aim pitch
        const aim = 1.35 + pitch * 0.8;
        this.armR.rotation.set(aim, 0, 0.15);
        this.armL.rotation.set(aim + 0.1, 0, -0.45);
        this.gun.position.y = 1.12 + pitch * 0.25;
        this.gun.rotation.x = pitch * 0.8;
        this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.06 * run;
    }

    die(impulse) {
        this.dead = true;
        this.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3).add(impulse);
    }

    revive() {
        this.dead = false;
        this.body.rotation.set(0, 0, 0);
        this.body.position.set(0, 0, 0);
    }

    tumble(dt) {
        this.body.rotation.x += this.spin.x * dt;
        this.body.rotation.z += this.spin.z * dt;
    }

    setFlash(on) {
        this.mat.emissive.setScalar(on ? 0.6 : 0);
        this.lightMat.emissive.setScalar(on ? 0.6 : 0);
    }
}
