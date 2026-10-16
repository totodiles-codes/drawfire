import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Space, SUN_DIR } from './space.js';

function isLowEnd(renderer) {
    if (new URLSearchParams(location.search).has('low')) return true;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return /swiftshader|llvmpipe|software/i.test(name);
}

// Renders space -> arena -> first-person viewmodel, each layer with a fresh depth buffer.
class LayeredRenderPass extends Pass {
    constructor(layers) {
        super();
        this.layers = layers;
        this.needsSwap = false;
    }

    render(renderer, writeBuffer, readBuffer) {
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, true);
        this.layers.forEach((layer, i) => {
            if (!layer.enabled) return;
            if (i > 0) renderer.clearDepth();
            renderer.render(layer.scene, layer.camera);
        });
        renderer.autoClear = oldAutoClear;
    }
}

export class Graphics {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
        this.lowEnd = isLowEnd(this.renderer);
        this.maxRatio = Math.min(window.devicePixelRatio, 1.75);
        this.ratio = this.lowEnd ? 0.5 : this.maxRatio;
        this.renderer.setPixelRatio(this.ratio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.perf = { time: 0, frames: 0 };

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
        this.space = new Space({ octaves: this.lowEnd ? 3 : 6 });

        this.viewScene = new THREE.Scene();
        this.viewCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);

        this.setupLights();

        const size = new THREE.Vector2();
        this.renderer.getDrawingBufferSize(size);
        const target = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, {
            type: THREE.HalfFloatType,
            samples: 4,
        });
        this.composer = new EffectComposer(this.renderer, target);
        this.layers = {
            space: { scene: this.space.scene, camera: this.space.camera, enabled: true },
            world: { scene: this.scene, camera: this.camera, enabled: true },
            view: { scene: this.viewScene, camera: this.viewCamera, enabled: false },
        };
        this.composer.addPass(new LayeredRenderPass([this.layers.space, this.layers.world, this.layers.view]));
        // threshold sits above sunlit white surfaces so only emissive effects glow
        this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.35, 3.2);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setupLights() {
        const sun = new THREE.DirectionalLight(0xffffff, 3.0);
        sun.position.copy(SUN_DIR).multiplyScalar(120);
        sun.castShadow = true;
        const size = this.lowEnd ? 1024 : 4096;
        sun.shadow.mapSize.set(size, size);
        const s = sun.shadow.camera;
        s.left = -80;
        s.right = 80;
        s.top = 80;
        s.bottom = -80;
        s.near = 10;
        s.far = 300;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.04;
        this.scene.add(sun, sun.target);
        this.sun = sun;
        this.scene.add(new THREE.HemisphereLight(0xc4d2ff, 0x4a6a96, 1.15));

        const vSun = new THREE.DirectionalLight(0xffffff, 2.6);
        this.viewSun = vSun;
        this.viewScene.add(vSun, vSun.target);
        this.viewScene.add(new THREE.HemisphereLight(0xc4d2ff, 0x4a6a96, 1.3));
    }

    resize() {
        // a collapsed preview pane can report 0 x 0; keep the projection finite
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        this.renderer.setSize(w, h, false);
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(w, h);
        for (const cam of [this.camera, this.viewCamera]) {
            cam.aspect = w / h;
            cam.updateProjectionMatrix();
        }
    }

    // Dynamic resolution: trade pixels for frame rate on slower GPUs.
    adapt(dt) {
        const p = this.perf;
        p.time += dt;
        p.frames++;
        if (p.time < 1.5) return;
        const avg = p.time / p.frames;
        p.time = 0;
        p.frames = 0;
        let next = this.ratio;
        if (avg > 1 / 45) next = Math.max(0.5, this.ratio * 0.85);
        else if (avg < 1 / 75) next = Math.min(this.maxRatio, this.ratio * 1.1);
        if (Math.abs(next - this.ratio) > 0.01) {
            this.ratio = next;
            this.renderer.setPixelRatio(next);
            this.resize();
        }
    }

    render(time) {
        this.space.update(this.camera, time);
        if (this.layers.view.enabled) {
            // keep the viewmodel lit from the same sun direction as the world
            const inv = this.camera.quaternion.clone().invert();
            this.viewSun.position.copy(SUN_DIR).applyQuaternion(inv).multiplyScalar(10);
        }
        this.composer.render();
    }
}
