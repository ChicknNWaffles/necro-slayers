const {app,BrowserWindow}=require('electron');const path=require('path'),fs=require('fs');
app.whenReady().then(async()=>{try{
fs.mkdirSync(path.resolve(__dirname,'../out/clearing-review'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../out/clearing-review/index.html'),'<body style="margin:0">');
const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});const errors=[];win.webContents.on('console-message',(_e,l,m)=>{if(l===3)errors.push(m)});
await win.loadFile(path.resolve(__dirname,'../out/clearing-review/index.html'));
const result=await win.webContents.executeJavaScript(`(async()=>{
const {createClearing}=await import('../../src/clearing.js');
const {createForest}=await import('../../src/forestModel.js');
const fail=(m)=>{throw new Error(m)};
const a=createClearing(42),b=createClearing(42),c=createClearing(43);
if(JSON.stringify(a.trees)!==JSON.stringify(b.trees))fail('Same seed should give the same clearing');
if(JSON.stringify(a.trees)===JSON.stringify(c.trees))fail('Different seeds should give different clearings');
for(let seed=1;seed<=25;seed++){
  const k=createClearing(seed);
  if(k.paths.length!==2)fail('Two paths expected');
  const gap=Math.abs(Math.atan2(Math.sin(k.paths[0].angle-k.paths[1].angle),Math.cos(k.paths[0].angle-k.paths[1].angle)));
  if(gap<2)fail('Paths too close together: '+gap);
  if(k.trees.length<80)fail('Too few trees: '+k.trees.length);
  for(const t of k.trees)if(k.isWalkable(t.x,t.z,-0.5))fail('A tree stands where characters walk');
  for(const p of k.paths){const q=p.points[Math.floor(p.points.length*0.9)];if(!k.isWalkable(q.x,q.z))fail('Path not walkable far along');if(k.isWalkable(p.end.x+Math.sign(p.end.x)*3,p.end.z+Math.sign(p.end.z)*3))fail('Walkable past the end of a path');}
  if(!k.isWalkable(0,0))fail('Middle of the clearing should be walkable');
  const pos={x:40,z:0};k.keepWalkable(pos);if(!k.isWalkable(pos.x,pos.z))fail('keepWalkable should bring a position back');
}
const t0=performance.now();const forest=createForest(createClearing(7));const ms=performance.now()-t0;
let meshes=0;forest.group.traverse(n=>{if(n.isMesh)meshes++;});
return {ms:Math.round(ms),meshes};})()`);
if(errors.length)throw new Error(errors.join('\n'));
console.log('PASS: seeded clearings with two walkable paths and trees kept off them; forest built in',result.ms,'ms with',result.meshes,'meshes');app.exit(0);
}catch(e){console.error(e);app.exit(1)}});
