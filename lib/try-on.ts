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
  shadow = new T.Mesh(new T.PlaneGeometry(6, 6), new T.ShadowMaterial({opacity: 0.3}));
  skidMarksGroup = new T.Group();
  env: T.WebGLRenderTarget;
  observer: ResizeObserver;

  stream: MediaStream | null = null;
  video: HTMLVideoElement | null = null;
  dead = false;
  request = 0;
  last = 0;
  direction = {x: 0, z: 0};
  size = 1;
  angle = 0;
  isDrifting = false;
  velocity = new T.Vector3();
  carSpeed = 0;

  // Real world gyroscope / orientation tracking
  deviceBeta = 0;
  deviceGamma = 0;
  deviceAlpha = 0;
  hasOrientation = false;
  basePitch = 0;
  baseYaw = 0;
  baseRoll = 0;
  baseCameraPos = new T.Vector3(0, 2.7, 3.1);

  constructor(private host:HTMLElement,private emit:(s:ViewState)=>void){
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
    light.shadow.camera.left = -10;
    light.shadow.camera.right = 10;
    light.shadow.camera.top = 10;
    light.shadow.camera.bottom = -10;
    this.scene.add(light);

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
    // Endless driving: no small bounding box constraint!
    // The car can travel freely across the ground plane.
    // However, if size changes, we ensure valid numbers.
    if (!Number.isFinite(this.car.position.x)) this.car.position.x = 0;
    if (!Number.isFinite(this.car.position.z)) this.car.position.z = 0;
  }

  private addSkidMark() {
    if (this.dead || typeof document === 'undefined') return;
    // Add realistic tire skid strip on the ground plane behind the rear tires
    const markGeo = new T.PlaneGeometry(0.18 * this.size, 0.08 * this.size);
    const markMat = new T.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const mark = new T.Mesh(markGeo, markMat);
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.z = -this.car.rotation.y;
    mark.position.copy(this.car.position);
    mark.position.y = 0.001;

    this.skidMarksGroup.add(mark);

    // Fade out and remove old skid marks
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
      const distance = this.camera.aspect < 0.75 ? 5.2 : 4;
      this.camera.position.set(0, distance * 0.65, distance * 0.75);
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
      // Real-world gyroscope compensation:
      // When the user moves/tilts their phone UP, deltaPitch > 0.
      // The 3D camera tilts up to follow the phone, so the car stays locked on the table/floor!
      if (this.state.mode === 'camera' && this.state.placed && this.hasOrientation) {
        const degToRad = Math.PI / 180;
        const deltaPitch = (this.deviceBeta - this.basePitch) * degToRad;
        const deltaYaw = (this.deviceAlpha - this.baseYaw) * degToRad;
        const deltaRoll = (this.deviceGamma - this.baseRoll) * degToRad;

        const baseRotX = -Math.atan2(this.baseCameraPos.y, this.baseCameraPos.z);
        this.camera.rotation.set(
          baseRotX + deltaPitch,
          -deltaYaw,
          -deltaRoll,
          'YXZ'
        );
      }

      if (this.state.placed) {
        const {x, z} = this.direction;
        const isMoving = x !== 0 || z !== 0;

        if (isMoving) {
          const length = Math.hypot(x, z);
          const moveSpeed = this.isDrifting ? 1.15 : 0.75;
          const targetVx = (x / length) * moveSpeed;
          const targetVz = (z / length) * moveSpeed;

          // Drift physics: inertia & powerslide slip
          const slipRate = this.isDrifting ? 4 : 14;
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
          const turnRate = this.isDrifting ? 20 : 12;
          this.car.rotation.y += delta * Math.min(1, dt * turnRate);

          // Rear-end drift angle styling (powerslide body tilt)
          if (this.isDrifting) {
            this.carModel.rotation.y = -delta * 0.45;
            this.addSkidMark();
          } else {
            this.carModel.rotation.y = 0;
          }
        } else {
          // Coasting decelerate
          this.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
          this.carSpeed = this.velocity.length();
          this.car.position.x += this.velocity.x * dt;
          this.car.position.z += this.velocity.z * dt;
          this.carModel.rotation.y *= Math.max(0, 1 - dt * 8);
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
