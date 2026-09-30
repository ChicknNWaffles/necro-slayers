const {app,BrowserWindow}=require('electron');
const path=require('path'); const fs=require('fs'); const assert=require('assert/strict');
app.whenReady().then(async()=>{try {
 fs.mkdirSync(path.resolve(__dirname,'../out/creator-review'),{recursive:true});
 fs.writeFileSync(path.resolve(__dirname,'../out/build-review.html'),'<html><body style="margin:0"></body></html>');
 const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{offscreen:true,backgroundThrottling:false}});
 await win.loadFile(path.resolve(__dirname,'../out/build-review.html'));
 const result=await win.webContents.executeJavaScript(`(async()=>{
 const THREE=await import('../node_modules/three/build/three.module.js');
 const {CharacterModel}=await import('../src/characterModel.js');
 const {createAppearance}=await import('../src/characterAppearance.js');
 const scene=new THREE.Scene();scene.background=new THREE.Color('#b4a17c');
 scene.add(new THREE.HemisphereLight(0xfff3dd,0x5b5042,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,5);scene.add(light);
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1000,700);document.body.append(renderer.domElement);
 const camera=new THREE.PerspectiveCamera(35,1000/700,.1,30);camera.position.set(0,1.2,6);camera.lookAt(0,1.05,0);
 const stats=[];
 for(const [i,build] of [.8,1.3].entries()) {
 const model=new CharacterModel(createAppearance({build,bodyType:'male'}));
 const geometry=model.body.children.find(n=>n.isSkinnedMesh).geometry;
 const p=geometry.attributes.position;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
 for(let j=0;j<p.count;j++) if(p.getY(j)>1.1&&p.getY(j)<1.3&&geometry.attributes.skinIndex.getX(j)===0 && geometry.attributes.skinWeight.getX(j)>.99){x0=Math.min(x0,p.getX(j));x1=Math.max(x1,p.getX(j));z0=Math.min(z0,p.getZ(j));z1=Math.max(z1,p.getZ(j));}
 stats.push({build,width:x1-x0,depth:z1-z0});model.root.position.x=i? .65:-.65;model.root.rotation.y=Math.PI/2;scene.add(model.root);
 }
 renderer.render(scene,camera);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return stats;
 })()`);
 console.log(JSON.stringify(result));
 assert(result[1].width>result[0].width*1.2);assert(result[1].depth>result[0].depth*1.5);
 fs.writeFileSync(path.resolve(__dirname,'../out/creator-review/body-builds.png'),(await win.webContents.capturePage()).toPNG());
 const regions=await win.webContents.executeJavaScript(`(async()=>{
 const {CharacterModel}=await import('../src/characterModel.js');
 const {createAppearance}=await import('../src/characterAppearance.js');
 const measure=(model,joint,y0,y1)=>{
 const g=model.body.children.find(n=>n.isSkinnedMesh).geometry,p=g.attributes.position;
 const bone=Object.values(model.joints).indexOf(model.joints[joint]);let lo=Infinity,hi=-Infinity;
 for(let i=0;i<p.count;i++)if(g.attributes.skinIndex.getX(i)===bone&&g.attributes.skinWeight.getX(i)>.9&&p.getY(i)>y0&&p.getY(i)<y1){lo=Math.min(lo,p.getZ(i));hi=Math.max(hi,p.getZ(i));}
 return hi-lo;
 };
 const base=new CharacterModel(createAppearance());const results=[];
 for(const [key,joint,y0,y1] of [['chestWeight','root',1.3,1.4],['bellyWeight','root',1.1,1.23],['hipWeight','root',.95,1.07],['armWeight','leftShoulder',0,2],['legWeight','leftHip',0,2]]){
 const model=new CharacterModel(createAppearance({[key]:1.4}));results.push({key,before:measure(base,joint,y0,y1),after:measure(model,joint,y0,y1)});model.dispose();
 }base.dispose();return results;
 })()`);
 for(const region of regions) assert(region.after>region.before*1.05,region.key+' increases regional depth');
 console.log('PASS: weight and all five regional sliders increase depth.',JSON.stringify(regions));app.exit(0);
}catch(e){console.error(e);app.exit(1);}});

