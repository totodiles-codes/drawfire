import * as THREE from 'three';

// Additive, bloom-friendly visual effects: laser beams, sparks, flashes, explosions, plasma orbs.

function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.tex = glowTexture();
        this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
        this.beamGeo.translate(0, 0.5, 0);
        this.beams = [];
        this.sprites = [];

        this.maxSparks = 900;
        this.sparkPos = new Float32Array(this.maxSparks * 3);
        this.sparkCol = new Float32Array(this.maxSparks * 3);
        this.sparkVel = new Float32Array(this.maxSparks * 3);
        this.sparkLife = new Float32Array(this.maxSparks);
        this.sparkMax = new Float32Array(this.maxSparks);
        this.sparkBase = new Float32Array(this.maxSparks * 3);
        this.sparkGrav = new Float32Array(this.maxSparks);
        this.sparkHead = 0;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
        this.sparks = new THREE.Points(
            g,
            new THREE.PointsMaterial({
                size: 0.22,
                map: this.tex,
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
            }),
        );
        this.sparks.frustumCulled = false;
        scene.add(this.sparks);
    }

    hdr(color, intensity) {
        return new THREE.Color(color).multiplyScalar(intensity);
    }

    beam(from, to, color, life = 0.24) {
        _dir.subVectors(to, from);
        const len = _dir.length();
        if (len < 0.01) return;
        _q.setFromUnitVectors(Y, _dir.divideScalar(len));
        const mk = (radius, col, opacity) => {
            const m = new THREE.Mesh(
                this.beamGeo,
                new THREE.MeshBasicMaterial({
                    color: col,
                    transparent: true,
                    opacity,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    toneMapped: false,
                }),
            );
            m.position.copy(from);
            m.quaternion.copy(_q);
            m.scale.set(radius, len, radius);
            m.frustumCulled = false;
            this.scene.add(m);
            return m;
        };
        const core = mk(0.018, this.hdr(0xffffff, 7), 1);
        const glow = mk(0.06, this.hdr(color, 3), 0.5);
        this.beams.push({ parts: [core, glow], life, max: life, radii: [0.018, 0.06] });
    }

    flash(pos, color, size, life, intensity = 4) {
        const s = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: this.tex,
                color: this.hdr(color, intensity),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            }),
        );
        s.position.copy(pos);
        s.scale.setScalar(size);
        this.scene.add(s);
        this.sprites.push({ s, life, max: life, size, grow: 0 });
        return s;
    }

    spark(pos, vel, color, life, intensity = 3, gravity = 9) {
        const i = this.sparkHead;
        this.sparkHead = (this.sparkHead + 1) % this.maxSparks;
        this.sparkPos.set([pos.x, pos.y, pos.z], i * 3);
        this.sparkVel.set([vel.x, vel.y, vel.z], i * 3);
        _c.set(color).multiplyScalar(intensity);
        this.sparkBase.set([_c.r, _c.g, _c.b], i * 3);
        this.sparkLife[i] = life;
        this.sparkMax[i] = life;
        this.sparkGrav[i] = gravity;
    }

    burst(pos, normal, color, count, speed, life, intensity = 3) {
        const v = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
            if (normal) v.addScaledVector(normal, 1.2).normalize();
            v.multiplyScalar(speed * (0.3 + Math.random() * 0.9));
            this.spark(pos, v, color, life * (0.5 + Math.random() * 0.8), intensity);
        }
    }

    impact(point, normal, color) {
        this.flash(point, color, 0.8, 0.12, 4.5);
        this.burst(point, normal, color, 8, 7, 0.4, 4.5);
        this.burst(point, normal, 0xffffff, 4, 9, 0.25, 4);
    }

    muzzle(point, color) {
        this.flash(point, color, 0.9, 0.06, 6);
    }

    explosion(point, color) {
        const s = this.flash(point, color, 3, 0.45, 6);
        this.sprites[this.sprites.length - 1].grow = 14;
        this.flash(point, 0xffffff, 2.5, 0.18, 8);
        this.burst(point, null, color, 50, 16, 0.9, 5);
        this.burst(point, null, 0xffe0b0, 20, 22, 0.5, 5);
        return s;
    }

    deathBurst(point, color) {
        this.flash(point, color, 2.4, 0.3, 5);
        this.burst(point, null, color, 26, 9, 0.8, 4.5);
    }

    createOrb(color) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 14, 10),
            new THREE.MeshBasicMaterial({ color: this.hdr(0xffe6c8, 8), toneMapped: false }),
        );
        const halo = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: this.tex,
                color: this.hdr(color, 5),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            }),
        );
        halo.scale.setScalar(1.9);
        group.add(core, halo);
        this.scene.add(group);
        return group;
    }

    removeOrb(group) {
        this.scene.remove(group);
        group.traverse((o) => {
            if (o.material) o.material.dispose();
            if (o.geometry && o.isMesh) o.geometry.dispose();
        });
    }

    // Glide jet exhaust from the backpack (behind the body, which faces -Z rotated by yaw).
    jetFlame(pos, yaw, color, dt) {
        const n = Math.ceil(dt * 90);
        const bx = Math.sin(yaw) * 0.3;
        const bz = Math.cos(yaw) * 0.3;
        for (let i = 0; i < n; i++) {
            _p.set(pos.x + bx + (Math.random() - 0.5) * 0.2, pos.y + 1.0, pos.z + bz + (Math.random() - 0.5) * 0.2);
            _dir.set((Math.random() - 0.5) * 1.6, -6 - Math.random() * 3, (Math.random() - 0.5) * 1.6);
            this.spark(_p, _dir, i % 2 ? 0xffc070 : color, 0.25, 5, -2);
        }
    }

    trail(pos, color) {
        _dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2);
        this.spark(pos, _dir, color, 0.35, 4.5, 0);
    }

    update(dt) {
        for (const b of this.beams) {
            b.life -= dt;
            const k = Math.max(0, b.life / b.max);
            b.parts.forEach((m, i) => {
                m.material.opacity = (i === 0 ? 1 : 0.5) * k;
                const r = b.radii[i] * (0.4 + 0.6 * k);
                m.scale.x = m.scale.z = r;
            });
            if (b.life <= 0) {
                for (const m of b.parts) {
                    this.scene.remove(m);
                    m.material.dispose();
                }
            }
        }
        this.beams = this.beams.filter((b) => b.life > 0);

        for (const sp of this.sprites) {
            sp.life -= dt;
            const k = Math.max(0, sp.life / sp.max);
            sp.s.material.opacity = k;
            if (sp.grow) sp.s.scale.setScalar(sp.size + (1 - k) * sp.grow);
            if (sp.life <= 0) {
                this.scene.remove(sp.s);
                sp.s.material.dispose();
            }
        }
        this.sprites = this.sprites.filter((s) => s.life > 0);

        for (let i = 0; i < this.maxSparks; i++) {
            if (this.sparkLife[i] <= 0) continue;
            this.sparkLife[i] -= dt;
            const k = Math.max(0, this.sparkLife[i] / this.sparkMax[i]);
            const j = i * 3;
            this.sparkVel[j + 1] -= this.sparkGrav[i] * dt;
            const drag = Math.exp(-dt * 2.5);
            this.sparkVel[j] *= drag;
            this.sparkVel[j + 1] *= drag;
            this.sparkVel[j + 2] *= drag;
            this.sparkPos[j] += this.sparkVel[j] * dt;
            this.sparkPos[j + 1] += this.sparkVel[j + 1] * dt;
            this.sparkPos[j + 2] += this.sparkVel[j + 2] * dt;
            this.sparkCol[j] = this.sparkBase[j] * k;
            this.sparkCol[j + 1] = this.sparkBase[j + 1] * k;
            this.sparkCol[j + 2] = this.sparkBase[j + 2] * k;
        }
        this.sparks.geometry.attributes.position.needsUpdate = true;
        this.sparks.geometry.attributes.color.needsUpdate = true;
    }

    clear() {
        for (const b of this.beams) {
            for (const m of b.parts) {
                this.scene.remove(m);
                m.material.dispose();
            }
        }
        for (const s of this.sprites) {
            this.scene.remove(s.s);
            s.s.material.dispose();
        }
        this.beams = [];
        this.sprites = [];
        this.sparkLife.fill(0);
        this.sparkCol.fill(0);
    }

    // Frees everything this instance created (live orbs belong to the caller: removeOrb them first).
    dispose() {
        this.clear();
        this.scene.remove(this.sparks);
        this.sparks.geometry.dispose();
        this.sparks.material.dispose();
        this.beamGeo.dispose();
        this.tex.dispose();
    }
}
