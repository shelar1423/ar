import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
// Run the real game loop with a headless renderer; no camera/browser permissions.
let source=fs.readFileSync(new URL('../lib/game.ts',import.meta.url),'utf8');
source=source.replace("constructor(private host:HTMLElement,private overlay:HTMLElement,private emit:(s:GameState)=>void){",`constructor(private host:HTMLElement,private overlay:HTMLElement,private emit:(s:GameState)=>void){
 if((globalThis as any).__headlessRace){this.renderer={render:()=>{}} as any;this.orbit={enabled:false} as any;return;}`);
let js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
js=js.replace(/from ['"]([^'"]+)['"]/g,(_,id)=>`from '${import.meta.resolve(id)}'`);
globalThis.__headlessRace=true;
const {Game}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const make=()=>{const g=new Game({}, {},()=>{});g.state.ready=true;g.buildTrack();g.start();return g};
const step=(g,seconds)=>{for(let i=0;i<seconds*60;i++)g.frame((g.last||1)+1000/60)};
const g=make();g.input('gas',true);step(g,2);assert(g.state.speed>1.9);assert(g.distance>0);g.pause();const t=g.state.time;step(g,2);assert.equal(g.state.time,t);assert.equal(g.keys.gas,false);g.pause();g.input('gas',true);g.input('boost',true);step(g,1);assert(g.state.speed>2.2);assert(g.state.energy<100);g.lane(-1);g.lane(-1);assert.equal(g.targetLane,-1);g.lane(1);g.lane(1);g.lane(1);assert.equal(g.targetLane,1);
const loss=make();step(loss,61);assert.equal(loss.state.phase,'lost');
const winner=make();winner.items=[];winner.input('gas',true);step(winner,50);assert.equal(winner.state.phase,'won');assert.equal(winner.state.lap,3);assert(winner.state.time>0);
const coin=make();const pickup=coin.items.find(i=>i.kind==='coin');coin.items=[pickup];coin.distance=pickup.t-.0001;coin.state.speed=2;coin.targetLane=pickup.lane/.43;coin.lanePosition=pickup.lane;coin.input('gas',true);step(coin,.1);assert.equal(coin.state.coins,1);step(coin,.1);assert.equal(coin.state.coins,1);
const crash=make();const obstacle=crash.items.find(i=>i.kind==='barrier');crash.items=[obstacle];crash.distance=obstacle.t-.0001;crash.state.speed=2;crash.targetLane=obstacle.lane/.43;crash.lanePosition=obstacle.lane;step(crash,.1);assert(crash.state.speed<1);assert(obstacle.hit);
const tools=[];globalThis.document={modelContext:{registerTool:(tool)=>tools.push(tool)}};g.registerTools();assert.equal(tools.length,2);assert.throws(()=>tools[1].execute({bad:true}));tools[1].execute({});assert.equal(tools[0].execute({}).phase,'running');assert.equal(g.state.coins,0);
console.log('PASS: movement, boost, bounded steering, pause, timeout, three-lap finish, coin collection, barrier collision, restart and tool contracts. AR and browser rendering require device testing.');
