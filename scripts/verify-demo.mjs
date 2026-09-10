import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const b = fs.readFileSync(new URL('../public/models/ballistik-upright.glb', import.meta.url));
const gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
assert(!gltf.skins?.length, 'Model must not depend on skeleton transforms');

let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const m of gltf.meshes) {
  for (const p of m.primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], a.min[i]);
      max[i] = Math.max(max[i], a.max[i]);
    }
  }
}
const size = max.map((v, i) => v - min[i]);
assert(size[1] < size[0] && size[0] < size[2]);
assert(Math.abs(size[2] - 1) < 0.001);
assert(Math.abs(min[1]) < 0.001);
assert(gltf.images.every(i => i.bufferView !== undefined), 'Textures must be embedded');

const usdz = fs.readFileSync(new URL('../public/models/ballistik.usdz', import.meta.url));
assert.equal(usdz.readUInt32LE(0), 0x04034b50);

// Verify tracking card SVG
const cardSvg = fs.readFileSync(new URL('../public/tracking-card.svg', import.meta.url), 'utf8');
assert(cardSvg.includes('<svg') && cardSvg.includes('HOT WHEELS'), 'Tracking card SVG must be valid');

// Transpile aruco.ts and CardTracker for testing
const arucoSource = fs.readFileSync(new URL('../lib/aruco.ts', import.meta.url), 'utf8');
const arucoJs = ts.transpileModule(arucoSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, id) => `from '${import.meta.resolve(id)}'`);
const arucoModuleUrl = 'data:text/javascript;base64,' + Buffer.from(arucoJs).toString('base64');

const trackerSource = fs.readFileSync(new URL('../lib/card-tracker.ts', import.meta.url), 'utf8');
const trackerJs = ts.transpileModule(trackerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
  if (id.includes('aruco')) return `from '${arucoModuleUrl}'`;
  return `from '${import.meta.resolve(id)}'`;
});
const trackerModuleUrl = 'data:text/javascript;base64,' + Buffer.from(trackerJs).toString('base64');
const { CardTracker } = await import(trackerModuleUrl);

// Test synthetic marker detection on 180x180 image
const tracker = new CardTracker(1.0);
const w = 180, h = 180;
const data = new Uint8ClampedArray(w * h * 4);
data.fill(255); // White quiet zone
const cellSize = 20;
// Draw 7x7 black square at (1,1)
for (let r = 1; r <= 7; r++) {
  for (let c = 1; c <= 7; c++) {
    for (let py = 0; py < cellSize; py++) {
      for (let px = 0; px < cellSize; px++) {
        const idx = ((r * cellSize + py) * w + (c * cellSize + px)) * 4;
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
      }
    }
  }
}
// White cells for ArUco ID 0
const whiteCells = [[2, 2], [2, 3], [2, 4], [2, 5], [2, 6]];
for (const [c, r] of whiteCells) {
  for (let py = 0; py < cellSize; py++) {
    for (let px = 0; px < cellSize; px++) {
      const idx = ((r * cellSize + py) * w + (c * cellSize + px)) * 4;
      data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 255;
    }
  }
}
const detectedMarkers = tracker.detectMarker(w, h, data);
assert.equal(detectedMarkers.length, 1, 'Should detect 1 synthetic marker');
assert.equal(detectedMarkers[0].id, 0, 'Marker ID should be 0');

// Transpile and test TryOn
let source = fs.readFileSync(new URL('../lib/try-on.ts', import.meta.url), 'utf8');
source = source.replace(
  /constructor\(private host:\s*HTMLElement,\s*private emit:\s*\(s:\s*ViewState\)\s*=>\s*void\)\s*\{/,
  `constructor(private host:HTMLElement,private emit:(s:ViewState)=>void){if((globalThis as any).__test){this.renderer={render:()=>{}} as any;this.orbit={update:()=>{}} as any;return;}`
);

let js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
  if (id.includes('card-tracker')) return `from '${trackerModuleUrl}'`;
  return `from '${import.meta.resolve(id)}'`;
});

globalThis.__test = true;
const { TryOn } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const v = new TryOn({}, () => {});
v.state.mode = 'preview';
v.state.ready = true;
v.move(1, 0);
assert.equal(v.direction.x, 0);
v.place();

const step = () => {
  for (let i = 0; i < 10; i++) v.frame((v.last || 1) + 16);
};

for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  v.reset();
  v.move(x, z);
  step();
  assert(x ? v.car.position.x * x > 0 : v.car.position.z * z > 0);
}
v.stop();
const before = v.car.position.clone();
step();
assert(v.car.position.equals(before));
v.move(1, 0);
for (let i = 0; i < 100; i++) step();
assert(v.car.position.x <= 0.45);

// Test scale limits
v.scale(10);
assert.equal(v.size, 1.6);
assert(v.car.position.x <= 0.151);
v.scale(-10);
assert.equal(v.size, 0.65);

// Test rotateBy gesture
const prevRot = v.angle;
v.rotateBy(Math.PI / 4);
assert.equal(v.angle, prevRot + Math.PI / 4);
assert.equal(v.car.rotation.y, v.angle);

// Test tracking mode and hiding when card is lost
v.state.mode = 'camera';
v.setTrackingMode('card');
assert.equal(v.state.trackingMode, 'card');
// In card mode without card visible in video, car is hidden
v.frame((v.last || 1) + 16);
assert.equal(v.car.visible, false, 'Car must be hidden when card tracking is lost');

// Switch to manual mode: car becomes visible
v.setTrackingMode('manual');
assert.equal(v.state.trackingMode, 'manual');
assert.equal(v.car.visible, true, 'Car must be visible in manual mode');

let stopped = false;
v.stream = { getTracks: () => [{ stop: () => (stopped = true) }] };
v.stopCamera();
assert(stopped && v.stream === null);

console.log('PASS: upright static model, embedded textures, USDZ archive, tracking card SVG, ArUco detection, pose estimation, gesture rotation, scale limits, card-lost car hiding, and camera cleanup.');
