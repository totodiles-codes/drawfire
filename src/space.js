import * as THREE from 'three';

// Background layer: the planet far below, its atmosphere and a star field. Rendered first with its
// own camera (huge far plane) so the arena keeps a tight depth range.

export const EARTH_RADIUS = 20000;
export const ORBIT_HEIGHT = 1500;
export const SUN_DIR = new THREE.Vector3(-0.45, 0.82, 0.36).normalize();

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i + vec3(0, 0, 0)), hash3(i + vec3(1, 0, 0)), f.x),
                   mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                   mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// fbm with per-octave fade based on screen-space footprint to avoid shimmering near the horizon.
float fbm(vec3 p, float footprint) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    float fp = footprint;
    for (int i = 0; i < OCTAVES; i++) {
        float w = 1.0 - smoothstep(0.25, 0.9, fp);
        sum += amp * mix(0.5, vnoise(p), w);
        norm += amp;
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        amp *= 0.5;
        fp *= 2.03;
    }
    return sum / norm;
}
`;

function createEarth(octaves) {
    const geo = new THREE.SphereGeometry(EARTH_RADIUS, 192, 128);
    const mat = new THREE.ShaderMaterial({
        defines: { OCTAVES: octaves },
        uniforms: {
            sunDir: { value: SUN_DIR.clone() },
            time: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vLocal;
            varying vec3 vWorld;
            varying vec3 vNormalW;
            void main() {
                vLocal = normalize(position);
                vec4 w = modelMatrix * vec4(position, 1.0);
                vWorld = w.xyz;
                vNormalW = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * w;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 sunDir;
            uniform float time;
            varying vec3 vLocal;
            varying vec3 vWorld;
            varying vec3 vNormalW;
            ${NOISE_GLSL}
            void main() {
                vec3 p = normalize(vLocal);
                float px = length(fwidth(p));

                // continents
                float cBase = fbm(p * 30.0 + vec3(4.0, 1.0, 7.0), px * 30.0);
                float land = smoothstep(0.565, 0.59, cBase);
                float detail = fbm(p * 260.0, px * 260.0);
                vec3 ocean = mix(vec3(0.008, 0.04, 0.11), vec3(0.02, 0.09, 0.2), detail);
                vec3 desert = vec3(0.36, 0.28, 0.17);
                vec3 green = vec3(0.12, 0.15, 0.08);
                vec3 landCol = mix(green, desert, smoothstep(0.42, 0.62, fbm(p * 90.0 + 3.0, px * 90.0)));
                landCol *= 0.75 + 0.5 * detail;
                vec3 col = mix(ocean, landCol, land);

                // puffy cloud clusters, domain warped, drifting slowly
                vec3 q = p * 520.0 + vec3(time * 0.03, 0.0, time * 0.015);
                float warp = fbm(p * 120.0, px * 120.0);
                float c = fbm(q + warp * 9.0, px * 520.0);
                float systems = smoothstep(0.42, 0.66, fbm(p * 70.0 + 11.0, px * 70.0));
                float clouds = smoothstep(0.52, 0.66, c) * (0.25 + 0.95 * systems);
                clouds = clamp(clouds + smoothstep(0.62, 0.78, systems) * 0.35, 0.0, 1.0);
                col = mix(col, vec3(0.9, 0.92, 0.95), clouds * 0.93);

                vec3 N = normalize(vNormalW);
                float diff = clamp(dot(N, sunDir), 0.0, 1.0);
                col *= 0.3 + 0.7 * diff;

                vec3 V = normalize(cameraPosition - vWorld);
                float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
                col = mix(col, vec3(0.5, 0.66, 0.9), clamp(fres * 1.1, 0.0, 0.92));

                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -EARTH_RADIUS - ORBIT_HEIGHT, 0);
    return mesh;
}

function createAtmosphere() {
    const geo = new THREE.SphereGeometry(EARTH_RADIUS * 1.025, 128, 64);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { center: { value: new THREE.Vector3() } },
        vertexShader: /* glsl */ `
            varying vec3 vWorld;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                vWorld = w.xyz;
                gl_Position = projectionMatrix * viewMatrix * w;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 center;
            varying vec3 vWorld;
            void main() {
                // distance of the view ray from the planet centre -> thin glowing limb
                vec3 dir = normalize(vWorld - cameraPosition);
                vec3 oc = center - cameraPosition;
                float tc = dot(oc, dir);
                float d = length(oc - dir * tc);
                float r0 = ${EARTH_RADIUS.toFixed(1)};
                float h = (d - r0) / (r0 * 0.025);
                float glow = exp(-max(h, 0.0) * 4.0) * step(0.0, h);
                vec3 col = vec3(0.35, 0.6, 1.0) * glow * 1.4;
                gl_FragColor = vec4(col, glow);
            }
        `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -EARTH_RADIUS - ORBIT_HEIGHT, 0);
    mat.uniforms.center.value.copy(mesh.position);
    return mesh;
}

function createStars() {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const r = 60000;
    for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        positions[i * 3] = s * Math.cos(th) * r;
        positions[i * 3 + 1] = Math.abs(u) * r * 0.9 - r * 0.15;
        positions[i * 3 + 2] = s * Math.sin(th) * r;
        const b = 0.35 + Math.pow(Math.random(), 3) * 0.9;
        colors[i * 3] = b;
        colors[i * 3 + 1] = b;
        colors[i * 3 + 2] = b * (0.95 + Math.random() * 0.1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
        size: 1.6,
        sizeAttenuation: false,
        vertexColors: true,
        depthWrite: false,
    });
    return new THREE.Points(geo, mat);
}

export class Space {
    constructor({ octaves = 6 } = {}) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.camera = new THREE.PerspectiveCamera(60, 1, 5, 200000);
        this.earth = createEarth(octaves);
        this.scene.add(this.earth, createAtmosphere(), createStars());
    }

    update(mainCamera, time) {
        this.camera.position.copy(mainCamera.position);
        this.camera.quaternion.copy(mainCamera.quaternion);
        if (this.camera.fov !== mainCamera.fov || this.camera.aspect !== mainCamera.aspect) {
            this.camera.fov = mainCamera.fov;
            this.camera.aspect = mainCamera.aspect;
            this.camera.updateProjectionMatrix();
        }
        this.earth.material.uniforms.time.value = time;
    }
}
