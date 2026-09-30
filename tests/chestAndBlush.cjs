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
 const {blushColour}=await import('../src/headModel.js');
 for(const hex of ['#f6d9c6','#b69a70','#503628','#372a24']){
 const skin=new THREE.Color(hex),blush=blushColour(skin);const a=skin.getHSL({},THREE.SRGBColorSpace),b=blush.getHSL({},THREE.SRGBColorSpace);
 if(b.s<=a.s) throw new Error('Blush must be more saturated');
 if(a.l<.3&&b.l>a.l*1.15)throw new Error('Dark blush must retain skin depth');
 }
 const stats=[];
 for(const [i,build] of [1,1.3].entries()) {
 const model=new CharacterModel(createAppearance({build,bodyType:'female',chestWeight:1.4,bellyWeight:1.4,hipWeight:1.4,armWeight:1.4,legWeight:1.4}));
 const geometry=model.body.children.find(n=>n.isSkinnedMesh).geometry;
 const pos=geometry.attributes.position, edges=new Map(), ids=[];
 for(let v=0;v<pos.count;v++)ids.push([pos.getX(v),pos.getY(v),pos.getZ(v)].map(n=>Math.round(n*100000)).join(','));
 const ix=geometry.index;const count=ix?ix.count:pos.count;
 for(let t=0;t<count;t+=3){const v=[0,1,2].map(k=>ix?ix.getX(t+k):t+k);for(let k=0;k<3;k++){let a=v[k],b=v[(k+1)%3];if(ids[a]===ids[b])continue;const key=[ids[a],ids[b]].sort().join('|');const e=edges.get(key)||{n:0,y:(pos.getY(a)+pos.getY(b))/2};e.n++;edges.set(key,e);}}
 const open=[...edges.values()].filter(e=>e.n===1&&e.y>1.05&&e.y<1.45).length;
 if(open)throw new Error('Open chest edges: '+open);
 const p=geometry.attributes.position;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
 for(let j=0;j<p.count;j++) if(p.getY(j)>1.1&&p.getY(j)<1.3&&geometry.attributes.skinIndex.getX(j)===0 && geometry.attributes.skinWeight.getX(j)>.99){x0=Math.min(x0,p.getX(j));x1=Math.max(x1,p.getX(j));z0=Math.min(z0,p.getZ(j));z1=Math.max(z1,p.getZ(j));}
 stats.push({build,width:x1-x0,depth:z1-z0});model.root.position.x=i? .65:-.65;model.root.rotation.y= i ? Math.PI/2 : Math.PI;scene.add(model.root);
 }
 renderer.render(scene,camera);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return stats;
 })()`);
 console.log(JSON.stringify(result));
 assert(result[1].depth>result[0].depth);
 fs.writeFileSync(path.resolve(__dirname,'../out/creator-review/chest-fix.png'),(await win.webContents.capturePage()).toPNG());
 app.exit(0);
}catch(e){console.error(e);app.exit(1);}});