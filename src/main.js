import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createLevel, zones } from './level.js';
import { CharacterAnimations } from './animation.js';
import { Player } from './player.js';
import { SoundSystem } from './sound.js';
import './style.css';

const defaults={walkSpeed:2,runSpeed:5,crouchSpeed:1,heavyHeight:4.5,sensitivity:.0026,cameraDistance:4.5,followSpeed:9,volume:.45,movementVolume:.7,ambientVolume:.35,fade:.18};
const settings={...defaults,...JSON.parse(localStorage.getItem('parkour-settings')||'{}')};
const bindings={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',run:'ShiftLeft',jump:'Space',crouch:'ControlLeft',descend:'KeyC',release:'KeyE',reset:'KeyR',...JSON.parse(localStorage.getItem('parkour-bindings')||'{}')};
const app=document.querySelector('#app');
app.innerHTML=`<div id="hud"><b>ParkourGame · прототип</b><div id="status">Загрузка…</div><small>WASD — движение · Shift — бег и паркур<br>Space — прыжок, повторно в воздухе — кувырок<br>Ctrl — скрытность · C — спуск · E — отпустить уступ<br>R — вернуть персонажа · Esc — меню · F3 — диагностика</small></div><div id="hint">Нажмите «Играть», чтобы захватить курсор</div><div id="diagnostics"></div><div id="animation-tools"><label>Проверка клипа <select id="clip-select"></select></label> <button id="clip-play">▶</button></div><div id="menu"><div class="panel"><h1>ParkourGame</h1><div class="muted">Тестовый уровень для проверки движения и анимаций</div><div class="row"><button id="resume">Играть</button><button id="reset">Вернуть персонажа</button></div><h2>Испытательная зона</h2><div class="row" id="zones"></div><h2>Настройки</h2><div id="settings"></div><h2>Клавиши</h2><div id="bindings"></div><h2>Ресурсы и ограничения</h2><div id="asset-info" class="muted">Загрузка модели…</div></div></div>`;
const $=s=>document.querySelector(s);
const menu=$('#menu'), status=$('#status'),diagnostics=$('#diagnostics');let paused=true,debug=false,ready=false,manualClip=null;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x9cb5c9);scene.fog=new THREE.Fog(0x9cb5c9,45,105);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;app.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,120);camera.position.set(0,3,8);
scene.add(new THREE.HemisphereLight(0xddeeff,0x657084,2.1));const sun=new THREE.DirectionalLight(0xffe5bf,2.6);sun.position.set(-12,28,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-48;sun.shadow.camera.right=48;sun.shadow.camera.top=48;sun.shadow.camera.bottom=-48;scene.add(sun);
const keys=new Set(),pressed=new Set();const input={};let yaw=0,pitch=.27,cameraDistance=settings.cameraDistance,follow=new THREE.Vector3(0,1,4),frame=0,fps=0;
const raycaster=new THREE.Raycaster();
function showMenu(){paused=true;keys.clear();pressed.clear();menu.classList.remove('hidden');if(document.pointerLockElement)document.exitPointerLock();}
function resume(){if(!ready)return;menu.classList.add('hidden');renderer.domElement.requestPointerLock();}
function fillSettings(){const labels={walkSpeed:'Скорость ходьбы',runSpeed:'Скорость бега',crouchSpeed:'Скорость скрытности',heavyHeight:'Тяжёлое падение, м',sensitivity:'Чувствительность мыши',cameraDistance:'Расстояние камеры',followSpeed:'Скорость камеры',volume:'Общая громкость',movementVolume:'Громкость движений',ambientVolume:'Громкость окружения',fade:'Смешивание анимаций'};
  const ranges={walkSpeed:[.5,5,.1],runSpeed:[2,9,.1],crouchSpeed:[.3,3,.1],heavyHeight:[2,8,.1],sensitivity:[.0005,.008,.0001],cameraDistance:[2,8,.1],followSpeed:[2,20,.5],volume:[0,1,.05],movementVolume:[0,1,.05],ambientVolume:[0,1,.05],fade:[.03,.5,.01]};
  $('#settings').innerHTML=Object.entries(labels).map(([key,label])=>`<label class="setting">${label}<span><input type="range" data-setting="${key}" min="${ranges[key][0]}" max="${ranges[key][1]}" step="${ranges[key][2]}" value="${settings[key]}"> <output>${settings[key]}</output></span></label>`).join('');
  document.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('input',()=>{settings[el.dataset.setting]=Number(el.value);el.nextElementSibling.value=el.value;if(el.dataset.setting==='cameraDistance')cameraDistance=Number(el.value);localStorage.setItem('parkour-settings',JSON.stringify(settings));}));
  const bindLabels={forward:'Вперёд',back:'Назад',left:'Влево',right:'Вправо',run:'Бег',jump:'Прыжок',crouch:'Скрытность',descend:'Спуск',release:'Отпустить уступ',reset:'Возврат'};
  $('#bindings').innerHTML=Object.entries(bindLabels).map(([key,label])=>`<label class="setting">${label}<button data-bind="${key}">${bindings[key]}</button></label>`).join('');
  document.querySelectorAll('[data-bind]').forEach(el=>el.onclick=()=>{el.textContent='Нажмите клавишу…';el.dataset.waiting='1';});
}
fillSettings();
window.addEventListener('keydown',e=>{const waiting=document.querySelector('[data-waiting]');if(waiting){bindings[waiting.dataset.bind]=e.code;waiting.textContent=e.code;delete waiting.dataset.waiting;localStorage.setItem('parkour-bindings',JSON.stringify(bindings));e.preventDefault();return;}
  if(e.code==='Escape'){showMenu();return;}if(e.code==='F3'){debug=!debug;diagnostics.classList.toggle('visible',debug);$('#animation-tools').classList.toggle('visible',debug);return;}
  if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();pressed.clear();showMenu();});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement){$('#hint').style.display='block';showMenu();}else{paused=false;$('#hint').style.display='none';}});
document.addEventListener('mousemove',e=>{if(!paused&&document.pointerLockElement){yaw-=e.movementX*settings.sensitivity;pitch=THREE.MathUtils.clamp(pitch-e.movementY*settings.sensitivity,-.2,1.2);}});
renderer.domElement.addEventListener('wheel',e=>{cameraDistance=THREE.MathUtils.clamp(cameraDistance+Math.sign(e.deltaY)*.35,2,8);e.preventDefault();},{passive:false});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
$('#resume').onclick=resume;
function readInput(){return {forward:keys.has(bindings.forward),back:keys.has(bindings.back),left:keys.has(bindings.left),right:keys.has(bindings.right),shift:keys.has(bindings.run)||keys.has('ShiftRight'),jump:keys.has(bindings.jump),jumpPressed:pressed.has(bindings.jump),toggleCrouch:pressed.has(bindings.crouch)||pressed.has('ControlRight'),descend:keys.has(bindings.descend),release:pressed.has(bindings.release)};}

await RAPIER.init();const world=new RAPIER.World({x:0,y:-20,z:0});const level=createLevel(scene,world);const sound=new SoundSystem(settings);await sound.load();
const debugGroup=new THREE.Group();debugGroup.visible=false;scene.add(debugGroup);
const capsuleDebug=new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.24,4,10),new THREE.MeshBasicMaterial({color:0x4fe4b2,wireframe:true,depthTest:false}));debugGroup.add(capsuleDebug);
const directionDebug=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(),1.4,0xffe27a,.28,.16);debugGroup.add(directionDebug);
for(const obstacle of level.obstacles.filter(o=>o.ledge)){
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),new THREE.MeshBasicMaterial({color:0x77e8ff,depthTest:false}));
  marker.position.set(obstacle.x,obstacle.top+.12,obstacle.z);debugGroup.add(marker);
}
const animations=new CharacterAnimations(scene,t=>{status.textContent=`Загрузка ${t}`;},settings);let player;
try {const report=await animations.load();player=new Player(world,level.obstacles,animations,settings,sound);window.__parkour={player,animations,report};ready=true;
  const all=Object.entries(report.clips).map(([state,clip])=>`<option value="${state}">${state} · ${clip.file.split('/').pop()} (${clip.duration.toFixed(2)} c)</option>`).join('');$('#clip-select').innerHTML=all;
  $('#asset-info').innerHTML=`Модель: Y Bot.fbx · высота FBX ${report.height.toFixed(2)} · масштаб ${report.scale.toFixed(4)}<br>Загружено клипов: ${Object.keys(report.clips).length}. ${report.missing.length?`Ошибки: <span class="error">${report.missing.join('; ')}</span>`:'Все выбранные клипы загружены.'}<br>Кувырок при втором прыжке вращает модель процедурно: отдельного клипа для него нет. Висение и боковое перемещение по уступу пока используют позу лазания.`;
  $('#clip-play').onclick=()=>{manualClip=$('#clip-select').value;animations.play(manualClip);};
  $('#reset').onclick=()=>player.reset();$('#zones').innerHTML=zones.map((z,i)=>`<button data-zone="${i}">${z.name}</button>`).join('');document.querySelectorAll('[data-zone]').forEach(el=>el.onclick=()=>{player.setCheckpoint(zones[Number(el.dataset.zone)].at);showMenu();});
  status.textContent='Готово · начальная площадка';
}catch(error){status.textContent='Ошибка загрузки персонажа';$('#asset-info').innerHTML=`<span class="error">${error.stack||error}</span>`;console.error(error);}
let previous=performance.now(),accumulator=0,frames=0,fpsClock=0;const step=1/60;
function updateCamera(dt){if(!player)return;const center=player.pos.clone().add(new THREE.Vector3(0,1.25,0));follow.lerp(center,1-Math.exp(-settings.followSpeed*dt));
  const desired=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(cameraDistance);
  const length=desired.length();raycaster.set(follow,desired.clone().normalize());raycaster.far=length;const hits=raycaster.intersectObjects(level.obstacles.map(o=>o.mesh),false);const dist=hits.length?Math.max(.8,hits[0].distance-.3):length;
  camera.position.lerp(follow.clone().addScaledVector(desired.normalize(),dist),1-Math.exp(-12*dt));camera.lookAt(follow);
}
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-previous)/1000);previous=now;frames++;fpsClock+=dt;if(fpsClock>.5){fps=Math.round(frames/fpsClock);fpsClock=0;frames=0;}
  if(ready&&!paused){accumulator=Math.min(.2,accumulator+dt);while(accumulator>=step){const state=readInput();if(pressed.has(bindings.reset))player.reset();player.step(step,state,yaw);world.step();pressed.clear();accumulator-=step;}
    if(animations.root){animations.root.position.copy(player.pos);animations.root.rotation.y=player.facing+Math.PI;
      animations.flipPivot.rotation.x=player.flipPhase?Math.PI*2*player.flipPhase:0;}
    debugGroup.visible=debug;
    if(debug){capsuleDebug.position.copy(player.pos).add(new THREE.Vector3(0,player.crouch?.6:.9,0));capsuleDebug.scale.y=player.crouch?.67:1;
      directionDebug.position.copy(player.pos).add(new THREE.Vector3(0,.08,0));directionDebug.setDirection(new THREE.Vector3(-Math.sin(player.facing),0,-Math.cos(player.facing)));}
    animations.update(dt);updateCamera(dt);status.textContent=`${player.state} · ${Math.hypot(player.velocity.x,player.velocity.z).toFixed(1)} м/с`;
    if(debug)diagnostics.textContent=`Состояние: ${player.state}\nАнимация: ${animations.info}${player.flipTime>0?' + процедурный кувырок':''}\nПрыжки: ${player.jumpCount}/2\nСкорость: ${Math.hypot(player.velocity.x,player.velocity.z).toFixed(2)} м/с\nВертикальная: ${player.velocity.y.toFixed(2)} м/с\nПоследнее падение: ${player.fallHeight.toFixed(2)} м\nКонтакт с землёй: ${player.grounded}\nПрепятствие: ${player.obstacle}\nУступ: ${player.ledge?.obstacle.kind||'нет'}\nКадров/с: ${fps}\nНет отдельных клипов: Air Flip, Ledge Hang, Ledge Move, Pull Up, Descend, Landing`;
  }else if(ready)animations.update(dt);
  renderer.render(scene,camera);
}
requestAnimationFrame(animate);
document.addEventListener('pointerdown',()=>sound.unlock().catch(()=>{}),{once:true});
