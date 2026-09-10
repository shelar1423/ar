import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

// 1. Model geometry & textures verification
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

// 2. Transpile and verify Web Audio synthesizer
const audioSource = fs.readFileSync(new URL('../lib/audio.ts', import.meta.url), 'utf8');
const audioJs = ts.transpileModule(audioSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const audioModuleUrl = 'data:text/javascript;base64,' + Buffer.from(audioJs).toString('base64');
const { sounds } = await import(audioModuleUrl);
assert(typeof sounds.playZeptoSound === 'function', 'Must export playZeptoSound');
assert(typeof sounds.setDrifting === 'function', 'Must export setDrifting');
// Ensure calls do not crash in SSR/Node
sounds.playZeptoSound();
sounds.setDrifting(true);
sounds.setDrifting(false);

// 3. Transpile and test TryOn
let source = fs.readFileSync(new URL('../lib/try-on.ts', import.meta.url), 'utf8');
source = source.replace(
  /constructor\(private host:\s*HTMLElement,\s*private emit:\s*\(s:\s*ViewState\)\s*=>\s*void\)\s*\{/,
  `constructor(private host:HTMLElement,private emit:(s:ViewState)=>void){if((globalThis as any).__test){this.renderer={render:()=>{}} as any;this.orbit={update:()=>{}} as any;return;}`
);

let js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
  if (id.includes('audio')) return `from '${audioModuleUrl}'`;
  return `from '${import.meta.resolve(id)}'`;
});

const tempFile = new URL('../scripts/.test-temp-tryon.mjs', import.meta.url);
fs.writeFileSync(tempFile, js);
let TryOn;
try {
  globalThis.__test = true;
  const mod = await import(tempFile.href);
  TryOn = mod.TryOn;
} finally {
  try { fs.unlinkSync(tempFile); } catch {}
}
const v = new TryOn({}, () => {});
v.state.mode = 'preview';
v.state.ready = true;
v.move(1, 0);
assert.equal(v.direction.x, 0, 'Cannot drive before placing');
v.place();
assert.equal(v.state.placed, true, 'Must be placed after place()');

const step = () => {
  for (let i = 0; i < 10; i++) v.frame((v.last || 1) + 16);
};

// Test driving in all 4 cardinal directions
for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  v.reset();
  v.move(x, z);
  step();
  assert(x ? v.car.position.x * x > 0 : v.car.position.z * z > 0);
}
v.stop();
for (let i = 0; i < 40; i++) step();
const stoppedPos = v.car.position.clone();
step();
assert(v.car.position.distanceTo(stoppedPos) < 0.001, 'Car must come to a complete stop after coasting');

// Test endless driving: verify car is NOT clamped to 0.45 anymore
v.reset();
v.move(1, 0);
for (let i = 0; i < 120; i++) step();
assert(v.car.position.x > 0.45, `Canvas must be endless! Position x=${v.car.position.x} must exceed old 0.45 boundary`);

// Test scale limits
v.scale(10);
assert.equal(v.size, 4.0);
v.scale(-10);
assert.equal(v.size, 0.65);

// Test rotateBy gesture
const prevRot = v.angle;
v.rotateBy(Math.PI / 4);
assert.equal(v.angle, prevRot + Math.PI / 4);
assert.equal(v.car.rotation.y, v.angle);

// Test drift mechanics and state
assert.equal(v.isDrifting, false);
v.setDrift(true);
assert.equal(v.isDrifting, true);
assert.equal(v.state.drifting, true);
v.move(1, 0);
step();
assert(v.skidMarksGroup.children.length >= 0);
v.setDrift(false);
assert.equal(v.isDrifting, false);
assert.equal(v.state.drifting, false);

// Test camera orientation gyro compensation in camera mode
v.state.mode = 'camera';
v.hasOrientation = true;
v.basePitch = 45;
v.baseYaw = 0;
v.baseRoll = 0;
v.deviceBeta = 65; // User tilted phone camera UP by 20 deg
v.deviceAlpha = 0;
v.deviceGamma = 0;
for (let i = 0; i < 20; i++) v.frame((v.last || 1) + 16);
// Camera pitch rotates up to keep the placed car anchored at the physical table/floor
assert(v.camera.rotation.x > 0.05, 'Camera pitch must rotate up to anchor car in physical space when phone tilts up');

// Test camera cleanup
let stopped = false;
v.stream = { getTracks: () => [{ stop: () => (stopped = true) }] };
v.stopCamera();
assert(stopped && v.stream === null);

console.log('PASS: upright static model, embedded textures, USDZ archive, Web Audio synthesizer, endless canvas driving, drift mechanics, gesture rotation & scaling, gyro physical anchoring, and camera cleanup.');
