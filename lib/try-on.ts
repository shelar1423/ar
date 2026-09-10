import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {sounds} from './audio';

export type ViewState = {
  ready: boolean;
  progress: number;
  mode: 'product' | 'preview' | 'camera';
  placed: boolean;
  busy: boolean;
  error: string;
  size: number;
  rotationY: number;
  drifting: boolean;
  speed: number;
};

export class TryOn {
  state: ViewState = {
    ready: false,
    progress: 0,
    mode: 'product',
    placed: false,
    busy: false,
    error: '',
    size: 1,
    rotationY: 0,
    drifting: false,
    speed: 0,
  };

  scene = new T.Scene();
  camera = new T.PerspectiveCamera(36, 1, 0.01, 60);
  car = new T.Group();
  carModel = new T.Group();
  renderer: T.WebGLRenderer;
  orbit: OrbitControls;
  shadow = new T.Mesh(new T.PlaneGeometry(10, 10), new T.ShadowMaterial({opacity: 0.55}));
  skidMarksGroup = new T.Group();
  env: T.WebGLRenderTarget;
  observer: ResizeObserver;

  stream: MediaStream | null = null;
  video: HTMLVideoElement | null = null;
  dead = false;
  request = 0;
  last = 0;
  direction = {x: 0, z: 0};
  size = 1.35;
  angle = 0;
  isDrifting = false;
  driftAngle = 0;
  lastSkidTime = 0;
  velocity = new T.Vector3();
  carSpeed = 0;

  // Real world gyroscope / orientation tracking with stabilization filters
  deviceBeta = 0;
  deviceGamma = 0;
  deviceAlpha = 0;
  hasOrientation = false;
  basePitch = 0;
  baseYaw = 0;
  baseRoll = 0;
  smoothedPitch = 0;
  smoothedRoll = 0;
  targetPitch = 0;
  targetRoll = 0;
  baseCameraPos = new T.Vector3(0, 2.3, 2.5);

  constructor(private host:HTMLElement,private emit:(s:ViewState)=>void){
    this.renderer = new T.WebGLRenderer({alpha: true, antialias: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.domElement.className = 'car-canvas';
    host.appendChild(this.renderer.domElement);

    // Multi-angle studio lighting so model is bright and clearly visible in any room
    this.scene.add(new T.HemisphereLight(0xffffff, 0x9ca3af, 2.8));

    const keyLight = new T.DirectionalLight(0xffffff, 3.8);
    keyLight.position.set(3, 5, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.normalBias = 0.015;
    this.scene.add(keyLight);

    const fillLight = new T.DirectionalLight(0xfff5ea, 2.8);
    fillLight.position.set(-3, 4, -2);
    this.scene.add(fillLight);

    const frontLight = new T.DirectionalLight(0xffffff, 2.2);
    frontLight.position.set(0, 3, 5);
    this.scene.add(frontLight);

    const pm = new T.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.04);
    this.scene.environment = this.env.texture;
    pm.dispose();
    room.dispose();

    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.008;
    this.shadow.receiveShadow = true;
    this.scene.add(this.shadow);
    this.scene.add(this.skidMarksGroup);

    this.car.add(this.carModel);
    this.scene.add(this.car);

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
      this.carModel.add(g.scene);
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

    // Listen for device orientation for real-world gyro positioning
    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', this.handleOrientation, { passive: true });
    }
  }

  handleOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta !== null && e.gamma !== null) {
      this.deviceBeta = e.beta;
      this.deviceGamma = e.gamma;
      this.deviceAlpha = e.alpha || 0;
      this.hasOrientation = true;
    }
  };

  async requestOrientationPermission(): Promise<boolean> {
    if (typeof window !== 'undefined' && typeof (window as any).DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        const res = await (window as any).DeviceOrientationEvent.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  publish() {
    if (!this.dead) {
      this.state.size = this.size;
      this.state.rotationY = this.angle;
      this.state.drifting = this.isDrifting;
      this.state.speed = Math.round(this.carSpeed * 10);
      this.emit({
        ...this.state,
      });
    }
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
  }

  product() {
    this.stopCamera();
    this.stop();
    this.setDrift(false);
    this.car.visible = true;
    if (this.shadow) this.shadow.visible = true;
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
    this.car.visible = true;
    if (this.shadow) this.shadow.visible = true;
    this.state.mode = 'preview';
    this.state.placed = false;
    this.state.busy = false;
    this.state.error = '';
    this.configureDrive();
    this.publish();
  }

  configureDrive() {
    this.stop();
    this.setDrift(false);
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
    void this.requestOrientationPermission();
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
    void this.requestOrientationPermission();

    // Lock baseline device orientation to anchor the car in physical room space
    if (this.hasOrientation) {
      this.basePitch = this.deviceBeta;
      this.baseYaw = this.deviceAlpha;
      this.baseRoll = this.deviceGamma;
    } else {
      this.basePitch = 45;
      this.baseYaw = 0;
      this.baseRoll = 0;
    }
    this.targetPitch = 0;
    this.targetRoll = 0;
    this.smoothedPitch = 0;
    this.smoothedRoll = 0;
    this.baseCameraPos.copy(this.camera.position);

    this.publish();
  }

  move(x: number, z: number) {
    if (!this.state.placed) return;
    this.direction = {x, z};
  }

  reset() {
    this.stop();
    this.setDrift(false);
    this.car.position.set(0, 0, 0);
    this.car.rotation.set(0, 0, 0);
    this.angle = 0;
    this.velocity.set(0, 0, 0);
    this.carSpeed = 0;
    this.publish();
  }

  scale(delta: number) {
    this.size = T.MathUtils.clamp(this.size + delta, 0.65, 4.0);
    this.car.scale.setScalar(this.size);
    this.shadow.scale.setScalar(this.size);
    this.confine();
    this.publish();
  }

  rotateBy(delta: number) {
    this.angle += delta;
    this.car.rotation.y = this.angle;
    this.publish();
  }

  setDrift(drifting: boolean) {
    if (this.isDrifting === drifting) return;
    this.isDrifting = drifting;
    sounds.setDrifting(drifting);
    this.publish();
  }

  toggleDrift() {
    this.setDrift(!this.isDrifting);
  }

  confine() {
    if (!Number.isFinite(this.car.position.x)) this.car.position.x = 0;
    if (!Number.isFinite(this.car.position.z)) this.car.position.z = 0;
  }

  private addSkidMark() {
    if (this.dead || typeof document === 'undefined') return;
    const now = performance.now();
    if (now - this.lastSkidTime < 60) return;
    this.lastSkidTime = now;

    // Realistic dark rubber skid mark on the ground
    const markGeo = new T.PlaneGeometry(0.14 * this.size, 0.24 * this.size);
    const markMat = new T.MeshBasicMaterial({
      color: 0x141414,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const mark = new T.Mesh(markGeo, markMat);
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.z = -this.car.rotation.y;

    // Position behind the rear tires
    const backDist = -0.32 * this.size;
    mark.position.set(
      this.car.position.x + Math.sin(this.car.rotation.y) * backDist,
      0.002,
      this.car.position.z + Math.cos(this.car.rotation.y) * backDist
    );

    this.skidMarksGroup.add(mark);

    // Keep pool limited to 40 skid marks
    if (this.skidMarksGroup.children.length > 40) {
      const oldest = this.skidMarksGroup.children[0] as T.Mesh;
      this.skidMarksGroup.remove(oldest);
      oldest.geometry.dispose();
      (oldest.material as T.Material).dispose();
    }

    setTimeout(() => {
      if (mark.parent) {
        mark.parent.remove(mark);
        markGeo.dispose();
        markMat.dispose();
      }
    }, 4500);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.state.mode === 'product' ? 36 : 45;

    if (this.state.mode !== 'product') {
      const distance = this.camera.aspect < 0.75 ? 3.4 : 3.0;
      this.camera.position.set(0, distance * 0.68, distance * 0.75);
      this.camera.lookAt(0, 0, 0);
      this.baseCameraPos.copy(this.camera.position);
    }
    this.camera.updateProjectionMatrix();
  }

  frame = (ms: number) => {
    const dt = Math.min(0.05, (ms - (this.last || ms)) / 1000);
    this.last = ms;

    if (this.state.mode === 'product') {
      this.orbit?.update();
    } else {
      // Rock-solid gyroscope compensation with low-pass filtering and deadbanding
      if (this.state.mode === 'camera' && this.state.placed && this.hasOrientation) {
        const degToRad = Math.PI / 180;
        const rawDeltaPitch = (this.deviceBeta - this.basePitch) * degToRad;
        const rawDeltaRoll = (this.deviceGamma - this.baseRoll) * degToRad;

        // Deadband filter: ignore micro-tremors below 0.35 deg
        if (Math.abs(rawDeltaPitch - this.targetPitch) > 0.006) {
          this.targetPitch = rawDeltaPitch;
        }
        if (Math.abs(rawDeltaRoll - this.targetRoll) > 0.01) {
          this.targetRoll = rawDeltaRoll;
        }

        // Exponential smoothing (low-pass filter) to eliminate all shaking
        const smoothSpeed = Math.min(1.0, dt * 6.0);
        this.smoothedPitch += (this.targetPitch - this.smoothedPitch) * smoothSpeed;
        this.smoothedRoll += (this.targetRoll - this.smoothedRoll) * (smoothSpeed * 0.4);

        const baseRotX = -Math.atan2(this.baseCameraPos.y, this.baseCameraPos.z);
        this.camera.rotation.set(
          baseRotX + this.smoothedPitch,
          0, // Zero compass jitter!
          -this.smoothedRoll * 0.3, // Calm roll damping
          'YXZ'
        );
      }

      if (this.state.placed) {
        const {x, z} = this.direction;
        const isMoving = x !== 0 || z !== 0;

        if (isMoving) {
          const length = Math.hypot(x, z);
          const moveSpeed = this.isDrifting ? 1.25 : 0.75;
          const targetVx = (x / length) * moveSpeed;
          const targetVz = (z / length) * moveSpeed;

          // Drift physics: lower traction, higher lateral slip
          const slipRate = this.isDrifting ? 3.5 : 14;
          this.velocity.x += (targetVx - this.velocity.x) * dt * slipRate;
          this.velocity.z += (targetVz - this.velocity.z) * dt * slipRate;

          this.carSpeed = Math.hypot(this.velocity.x, this.velocity.z);

          // Endless movement across the ground surface
          this.car.position.x += this.velocity.x * dt;
          this.car.position.z += this.velocity.z * dt;
          this.confine();

          // Steering and drift oversteer rotation
          this.angle = Math.atan2(this.velocity.x, this.velocity.z);
          const current = this.car.rotation.y;
          const delta = Math.atan2(Math.sin(this.angle - current), Math.cos(this.angle - current));
          const turnRate = this.isDrifting ? 24 : 12;
          this.car.rotation.y += delta * Math.min(1, dt * turnRate);

          // Rear-end drift angle styling (powerslide body tilt & skid marks)
          if (this.isDrifting) {
            const targetSlide = x !== 0 ? (x > 0 ? -0.65 : 0.65) : Math.sin(Date.now() * 0.008) * 0.45;
            this.driftAngle = T.MathUtils.lerp(this.driftAngle, targetSlide, dt * 10);
            this.carModel.rotation.y = this.driftAngle;
            this.carModel.rotation.z = Math.sin(Date.now() * 0.02) * 0.04;
            this.addSkidMark();
          } else {
            this.driftAngle = T.MathUtils.lerp(this.driftAngle, 0, dt * 10);
            this.carModel.rotation.y = this.driftAngle;
            this.carModel.rotation.z = 0;
          }
        } else if (this.isDrifting) {
          // Stationary Donut Burnout Spin!
          this.angle += dt * 4.5;
          this.car.rotation.y = this.angle;
          this.carModel.rotation.y = 0.45;
          this.carModel.rotation.z = 0.04;
          this.carSpeed = 0.8;
          this.addSkidMark();
        } else {
          // Coasting decelerate
          this.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
          this.carSpeed = this.velocity.length();
          this.car.position.x += this.velocity.x * dt;
          this.car.position.z += this.velocity.z * dt;
          this.driftAngle = T.MathUtils.lerp(this.driftAngle, 0, dt * 10);
          this.carModel.rotation.y = this.driftAngle;
          this.carModel.rotation.z = 0;
        }

        // Shadow follows the car across the endless ground
        if (this.shadow) {
          this.shadow.position.x = this.car.position.x;
          this.shadow.position.z = this.car.position.z;
        }
      }
    }
    this.renderer?.render(this.scene, this.camera);
  };

  keyDown = (e: KeyboardEvent) => {
    if (this.state.mode === 'product' || !this.state.placed || e.target instanceof HTMLInputElement) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
      e.preventDefault();
      this.setDrift(true);
      return;
    }
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
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
      this.setDrift(false);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      this.stop();
    }
  };

  visibility = () => {
    this.stop();
    this.setDrift(false);
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
    this.setDrift(false);
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.orbit.dispose();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.stop);
    window.removeEventListener('deviceorientation', this.handleOrientation);
    document.removeEventListener('visibilitychange', this.visibility);
    this.disposeTree(this.scene);
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
