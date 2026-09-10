import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {CardTracker} from './card-tracker';

export type ViewState = {
  ready: boolean;
  progress: number;
  mode: 'product' | 'preview' | 'camera';
  placed: boolean;
  busy: boolean;
  error: string;
  trackingMode: 'card' | 'manual';
  cardTracked: boolean;
  size: number;
  rotationY: number;
};

export class TryOn {
  state: ViewState = {
    ready: false,
    progress: 0,
    mode: 'product',
    placed: false,
    busy: false,
    error: '',
    trackingMode: 'card',
    cardTracked: false,
    size: 1,
    rotationY: 0,
  };

  scene = new T.Scene();
  camera = new T.PerspectiveCamera(36, 1, 0.01, 60);
  car = new T.Group();
  cardAnchor = new T.Group();
  tablePlane = new T.Group();
  renderer: T.WebGLRenderer;
  orbit: OrbitControls;
  shadow = new T.Mesh(new T.PlaneGeometry(20, 20), new T.ShadowMaterial({opacity: 0.2}));
  env: T.WebGLRenderTarget;
  observer: ResizeObserver;
  tracker: CardTracker;

  stream: MediaStream | null = null;
  video: HTMLVideoElement | null = null;
  dead = false;
  request = 0;
  last = 0;
  direction = {x: 0, z: 0};
  size = 1;
  angle = 0;

  constructor(private host:HTMLElement,private emit:(s:ViewState)=>void){
    this.tracker = new CardTracker(1.0);
    this.renderer = new T.WebGLRenderer({alpha: true, antialias: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.className = 'car-canvas';
    host.appendChild(this.renderer.domElement);

    this.scene.add(new T.HemisphereLight(0xffffff, 0x8d92ab, 2.4));
    const light = new T.DirectionalLight(0xffffff, 4);
    light.position.set(3, 5, 3);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = 0.015;
    light.shadow.camera.left = -5;
    light.shadow.camera.right = 5;
    light.shadow.camera.top = 5;
    light.shadow.camera.bottom = -5;
    this.scene.add(light);

    const pm = new T.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.04);
    this.scene.environment = this.env.texture;
    pm.dispose();
    room.dispose();

    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.008;
    this.shadow.receiveShadow = true;

    // Card tracking hierarchy
    // tablePlane rotates so that +Y is up (normal to the card), X and Z are table surface
    this.tablePlane.rotation.x = -Math.PI / 2;
    this.cardAnchor.add(this.tablePlane);
    this.scene.add(this.cardAnchor);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.enablePan = false;
    this.orbit.minDistance = 2.7;
    this.orbit.maxDistance = 5;
    this.orbit.maxPolarAngle = Math.PI * 0.47;
    this.orbit.minPolarAngle = 0.3;
    this.orbit.autoRotate = false;

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.product();

    new GLTFLoader().load('/models/ballistik-upright.glb', g => {
      if (this.dead) {
        this.disposeTree(g.scene);
        return;
      }
      g.scene.traverse(o => {
        if (o instanceof T.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.car.add(g.scene);
      this.state.ready = true;
      this.state.progress = 100;
      this.publish();
    }, e => {
      this.state.progress = Math.min(99, Math.round(e.loaded / (e.total || 8000000) * 100));
      this.publish();
    }, () => {
      this.state.error = 'The 3D car couldn’t load. Check your connection and reload.';
      this.publish();
    });

    this.renderer.setAnimationLoop(this.frame);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.stop);
    document.addEventListener('visibilitychange', this.visibility);
  }

  publish() {
    if (!this.dead) this.emit({...this.state, size: this.size, rotationY: this.angle});
  }

  stop = () => {
    this.direction = {x: 0, z: 0};
  };

  stopCamera() {
    this.request++;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.video?.remove();
    this.video = null;
    this.state.cardTracked = false;
  }

  product() {
    this.stopCamera();
    this.stop();
    this.scene.add(this.car);
    this.scene.add(this.shadow);
    this.car.visible = true;
    this.shadow.visible = true;
    this.state.mode = 'product';
    this.state.placed = false;
    this.state.busy = false;
    this.state.error = '';
    this.car.position.set(0, 0, 0);
    this.car.rotation.set(0, 0, 0);
    this.car.scale.setScalar(2.15);
    this.orbit.enabled = true;
    this.orbit.target.set(0, 0.22, 0);
    this.camera.position.set(2.3, 1.5, 2.7);
    this.camera.lookAt(this.orbit.target);
    this.resize();
    this.publish();
  }

  preview() {
    this.stopCamera();
    this.scene.add(this.car);
    this.scene.add(this.shadow);
    this.car.visible = true;
    this.shadow.visible = true;
    this.state.mode = 'preview';
    this.state.placed = false;
    this.state.busy = false;
    this.state.error = '';
    this.configureDrive();
    this.publish();
  }

  setTrackingMode(mode: 'card' | 'manual') {
    this.state.trackingMode = mode;
    if (this.state.mode === 'camera') {
      if (mode === 'card') {
        this.tablePlane.add(this.car);
        this.tablePlane.add(this.shadow);
        this.car.position.set(0, 0, 0);
        this.car.visible = false;
        this.shadow.visible = false;
      } else {
        this.scene.add(this.car);
        this.scene.add(this.shadow);
        this.car.visible = true;
        this.shadow.visible = true;
      }
      this.resize();
    }
    this.publish();
  }

  configureDrive() {
    this.stop();
    if (this.state.mode === 'camera' && this.state.trackingMode === 'card') {
      this.tablePlane.add(this.car);
      this.tablePlane.add(this.shadow);
      this.car.visible = false;
      this.shadow.visible = false;
    } else {
      this.scene.add(this.car);
      this.scene.add(this.shadow);
      this.car.visible = true;
      this.shadow.visible = true;
    }
    this.car.position.set(0, 0, 0);
    this.car.rotation.set(0, 0, 0);
    this.size = 1;
    this.car.scale.setScalar(1);
    this.angle = 0;
    this.orbit.enabled = false;
    this.resize();
  }

  async enableCamera() {
    if (!this.state.ready || this.state.busy) return;
    this.stopCamera();
    const ticket = this.request;
    this.state.busy = true;
    this.state.error = '';
    this.publish();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}},
        audio: false,
      });
      if (this.dead || ticket !== this.request) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      this.stream = stream;
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.className = 'camera-feed';
      this.video = video;
      this.host.appendChild(video);
      await video.play();
      if (this.dead || ticket !== this.request) return;
      this.state.mode = 'camera';
      this.state.placed = false;
      this.configureDrive();
    } catch {
      if (ticket === this.request) {
        this.stopCamera();
        this.state.error = 'Camera access was blocked. Allow camera access in Safari’s website settings, or try the 3D demo.';
      }
    } finally {
      if (!this.dead) {
        this.state.busy = false;
        this.publish();
      }
    }
  }

  place() {
    if (!this.state.ready || this.state.mode === 'product') return;
    this.state.placed = true;
    this.publish();
  }

  move(x: number, z: number) {
    if (!this.state.placed) return;
    this.direction = {x, z};
  }

  reset() {
    this.stop();
    this.car.position.set(0, 0, 0);
    this.car.rotation.set(0, 0, 0);
    this.angle = 0;
    this.publish();
  }

  scale(delta: number) {
    this.size = T.MathUtils.clamp(this.size + delta, 0.65, 1.6);
    this.car.scale.setScalar(this.size);
    this.confine();
    this.publish();
  }

  rotateBy(delta: number) {
    this.angle += delta;
    this.car.rotation.y = this.angle;
    this.publish();
  }

  confine() {
    const limit = Math.max(0.12, 0.95 - this.size * 0.5);
    this.car.position.x = T.MathUtils.clamp(this.car.position.x, -limit, limit);
    this.car.position.z = T.MathUtils.clamp(this.car.position.z, -0.5, 0.5);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.state.mode === 'product' ? 36 : 45;

    if (this.state.mode === 'camera' && this.state.trackingMode === 'card') {
      // In card tracking mode, camera is at the center looking down -Z
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
    } else if (this.state.mode !== 'product') {
      const distance = this.camera.aspect < 0.75 ? 5.2 : 4;
      this.camera.position.set(0, distance * 0.65, distance * 0.75);
      this.camera.lookAt(0, 0, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  frame = (ms: number) => {
    const dt = Math.min(0.05, (ms - (this.last || ms)) / 1000);
    this.last = ms;

    if (this.state.mode === 'product') {
      this.orbit?.update();
    } else {
      // Process card tracking when in camera mode and card mode is enabled
      if (this.state.mode === 'camera' && this.state.trackingMode === 'card') {
        if (this.video) {
          const pose = this.tracker.processVideo(this.video);
          if (pose.detected) {
            this.cardAnchor.position.copy(pose.position);
            this.cardAnchor.quaternion.copy(pose.quaternion);
            this.car.visible = true;
            if (this.shadow) this.shadow.visible = true;
            if (!this.state.cardTracked) {
              this.state.cardTracked = true;
              this.publish();
            }
          } else {
            // Hide car when tracking lost so it doesn't float in air
            this.car.visible = false;
            if (this.shadow) this.shadow.visible = false;
            if (this.state.cardTracked) {
              this.state.cardTracked = false;
              this.publish();
            }
          }
        } else {
          this.car.visible = false;
          if (this.shadow) this.shadow.visible = false;
        }
      } else {
        this.car.visible = true;
        if (this.shadow) this.shadow.visible = true;
      }

      if (this.state.placed) {
        const {x, z} = this.direction;
        if (x || z) {
          const length = Math.hypot(x, z);
          this.car.position.x += (x / length) * dt * 0.65;
          this.car.position.z += (z / length) * dt * 0.65;
          this.confine();
          this.angle = Math.atan2(x, z);
          const current = this.car.rotation.y;
          const delta = Math.atan2(Math.sin(this.angle - current), Math.cos(this.angle - current));
          this.car.rotation.y += delta * Math.min(1, dt * 12);
        }
      }
    }
    this.renderer?.render(this.scene, this.camera);
  };

  keyDown = (e: KeyboardEvent) => {
    if (this.state.mode === 'product' || !this.state.placed || e.target instanceof HTMLInputElement) return;
    const map: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      KeyW: [0, -1],
      ArrowDown: [0, 1],
      KeyS: [0, 1],
      ArrowLeft: [-1, 0],
      KeyA: [-1, 0],
      ArrowRight: [1, 0],
      KeyD: [1, 0],
    };
    if (map[e.code]) {
      e.preventDefault();
      this.move(...map[e.code]);
    }
  };

  keyUp = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      this.stop();
    }
  };

  visibility = () => {
    this.stop();
    if (document.hidden && this.state.mode === 'camera') {
      this.preview();
      this.state.error = 'Camera paused while you were away. Return to the product page to enable it again.';
      this.publish();
    }
  };

  disposeTree(root: T.Object3D) {
    const textures = new Set<T.Texture>();
    root.traverse(o => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          Object.values(m).forEach(v => {
            if (v instanceof T.Texture) textures.add(v);
          });
          m.dispose();
        });
      }
    });
    textures.forEach(t => t.dispose());
  }

  dispose() {
    this.dead = true;
    this.stopCamera();
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.orbit.dispose();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.stop);
    document.removeEventListener('visibilitychange', this.visibility);
    this.disposeTree(this.scene);
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
