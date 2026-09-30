const {app,BrowserWindow}=require('electron');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
app.whenReady().then(async()=>{try{
fs.mkdirSync(path.resolve(__dirname,'../out/hair-review'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../out/hair-review/index.html'),'<body style="margin:0">');
const win=new BrowserWindow({show:false,width:1400,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});const errors=[];win.webContents.on('console-message',(_e,l,m)=>{if(l===3)errors.push(m)});
await win.loadFile(path.resolve(__dirname,'../out/hair-review/index.html'));
await win.webContents.executeJavaScript(`(async()=>{
const THREE=await import('../../node_modules/three/build/three.module.js');const {CharacterModel}=await import('../../src/characterModel.js');const {createAppearance}=await import('../../src/characterAppearance.js');
const scene=new THREE.Scene();scene.background=new THREE.Color('#b4a17c');scene.add(new THREE.HemisphereLight(0xffffff,0x665544,1.6));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-3,5,4);scene.add(sun);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1400,800);document.body.append(renderer.domElement);const camera=new THREE.OrthographicCamera(-1.4,1.4,.8,-.8,.1,30);camera.position.set(0,2,5);camera.lookAt(0,1.8,0);
const styles=['ponytail','twintails','ponytail','twintails'];const bangs=['none','none','sideSwept','fringe'];
for(let i=0;i<4;i++){const model=new CharacterModel(createAppearance({hairStyle:styles[i],bangs:bangs[i]}));model.root.position.x=(i-1.5)*.67;model.root.rotation.y=i<2?Math.PI*.35:Math.PI;scene.add(model.root);}
renderer.render(scene,camera);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
// Every combination builds independently, including changing bangs on the existing model.
const model=new CharacterModel(createAppearance());
for(const hairStyle of ['bob','short','long','ponytail','twintails','braid','manBun'])for(const bangs of ['straight','sideSwept','fringe','blowout','none']){model.setAppearance(createAppearance({hairStyle,bangs}));model.body.traverse(n=>{if(n.isMesh)for(const v of n.geometry.attributes.position.array)if(!Number.isFinite(v))throw new Error('Invalid hair geometry');});}
model.dispose();
})()`);
fs.writeFileSync(path.resolve(__dirname,'../out/hair-review/styles.png'),(await win.webContents.capturePage()).toPNG());assert.deepEqual(errors.filter(e=>!/GPU stall|Automatic fallback/.test(e)),[]);console.log('PASS: 35 hairstyle/bangs combinations and rendered updos');app.exit(0);
}catch(e){console.error(e);app.exit(1)}});
