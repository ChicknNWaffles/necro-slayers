const {app,BrowserWindow}=require('electron');const path=require('path'),fs=require('fs');
app.whenReady().then(async()=>{try{
fs.mkdirSync(path.resolve(__dirname,'../out/armor-review'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../out/armor-review/index.html'),'<body style="margin:0">');
const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});const errors=[];win.webContents.on('console-message',(_e,l,m)=>{if(l===3)errors.push(m)});
await win.loadFile(path.resolve(__dirname,'../out/armor-review/index.html'));
const result=await win.webContents.executeJavaScript(`(async()=>{
const {CharacterModel}=await import('../../src/characterModel.js');const {createAppearance}=await import('../../src/characterAppearance.js');
const counts={};
for(const armor of ['none','leather','chainmail','plate'])for(const [bodyType,outfit] of [['female','dress'],['male','tunic'],['female','robes']]){
  const model=new CharacterModel(createAppearance({armor,bodyType,outfit}));
  for(let f=0;f<20;f++)model.animate({speed:1,running:true,onGround:true,backward:false},1/60);
  let mail=0,meshes=0;model.root.traverse(n=>{if(!n.isMesh)return;meshes++;if(n.material.customProgramCacheKey?.().startsWith('chainmail'))mail++;for(const v of n.geometry.attributes.position.array)if(!Number.isFinite(v))throw new Error('Invalid armour geometry: '+armor);});
  counts[armor+'/'+outfit]={mail,meshes};model.dispose();
}
return counts;})()`);
const wantsMail=(k)=>k.startsWith('chainmail');
for(const [k,{mail}] of Object.entries(result)){if(wantsMail(k)!==(mail>0))throw new Error('Chainmail overlay wrong for '+k+': '+mail);}
// Every outfit here has a skirt, so mail covers both the body and the skirt.
for(const [k,{mail}] of Object.entries(result))if(wantsMail(k)&&mail!==2)throw new Error('Expected body and skirt mail for '+k);
for(const o of ['dress','tunic','robes'])if(!(result['plate/'+o].meshes>result['none/'+o].meshes+10))throw new Error('Plate pieces missing for '+o);
if(errors.length)throw new Error(errors.join('\n'));
console.log('PASS: chainmail and plate on dresses, tunics and robes');app.exit(0);
}catch(e){console.error(e);app.exit(1)}});
