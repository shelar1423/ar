import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {USDZExporter} from 'three/addons/exporters/USDZExporter.js';
import {createCanvas,loadImage,Image,Canvas} from '@napi-rs/canvas';
globalThis.self=globalThis;
globalThis.ImageBitmap=Image;globalThis.HTMLImageElement=Image;globalThis.HTMLCanvasElement=Canvas;
globalThis.createImageBitmap=async blob=>loadImage(Buffer.from(await blob.arrayBuffer()));
const canvas=()=>{const c=createCanvas(1,1);c.toBlob=(cb,type)=>cb(new Blob([c.toBuffer(type||'image/png')],{type:type||'image/png'}));return c};
globalThis.document={createElement:canvas,createElementNS:canvas};
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.()})}readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result=`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;this.onloadend?.()})}};
const bytes=fs.readFileSync(new URL('../public/models/ballistik.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>o.skeleton?.update());
const flat=new T.Group();
gltf.scene.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.clone(),a=geo.getAttribute('position'),pos=new Float32Array(a.count*3),v=new T.Vector3();for(let i=0;i<a.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);v.toArray(pos,i*3)}geo.setAttribute('position',new T.BufferAttribute(pos,3));geo.deleteAttribute('skinIndex');geo.deleteAttribute('skinWeight');geo.computeVertexNormals();flat.add(new T.Mesh(geo,o.material))});
const before=new T.Box3().setFromObject(flat).getSize(new T.Vector3());
// Skinning cancels the original FBX axis rotation. Baking the evaluated pose
// preserves the upright car in exporters that do not support skeletal meshes.
flat.updateMatrixWorld(true);
const box=new T.Box3().setFromObject(flat),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
const scale=1/size.x;
// Bake an upright, centered, one-metre-long, +Z-forward car.
const normal=new T.Matrix4().makeRotationY(-Math.PI/2).multiply(new T.Matrix4().makeScale(scale,scale,scale)).multiply(new T.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z));
flat.children.forEach(o=>{o.geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(normal,o.matrixWorld));o.geometry.computeBoundingBox()});flat.rotation.set(0,0,0);flat.updateMatrixWorld(true);
const finalSize=new T.Box3().setFromObject(flat).getSize(new T.Vector3());
console.log('Bounds',before.toArray(),size.toArray(),finalSize.toArray());
if(!(finalSize.y<finalSize.x&&Math.abs(finalSize.z-1)<.001))throw new Error('Unexpected upright proportions');
const out=await new GLTFExporter().parseAsync(flat,{binary:true,maxTextureSize:1024});
fs.writeFileSync(new URL('../public/models/ballistik-upright.glb',import.meta.url),Buffer.from(out));
flat.scale.setScalar(.16);flat.updateMatrixWorld(true);
const usdz=await new USDZExporter().parseAsync(flat,{quickLookCompatible:true,maxTextureSize:1024});
fs.writeFileSync(new URL('../public/models/ballistik.usdz',import.meta.url),usdz);
console.log(JSON.stringify({before:before.toArray(),upright:finalSize.toArray(),glbBytes:out.byteLength,usdzBytes:usdz.byteLength}));
