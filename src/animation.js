import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const files = {
  idle: 'Action Adventure Pack/idle.fbx', run: 'New animation/Sprint.fbx',
  hang: 'New animation/Hanging Idle.fbx', hangAlt: 'New animation 2/Hanging Idle.fbx',
  runStop: 'Action Adventure Pack/run to stop.fbx', slide: 'New animation/Running Slide.fbx',
  turn: 'New animation 2/Change Direction.fbx', runTurn: 'New animation 2/Running To Turn.fbx',
  jump: 'Action Adventure Pack/jumping up.fbx', jumpRun: 'New animation 2/Running Jump.fbx',
  wallJump: 'New animation/Jump From Wall.fbx', airborne: 'Action Adventure Pack/falling idle.fbx',
  roll: 'Action Adventure Pack/falling to roll.fbx', heavy: 'Action Adventure Pack/hard landing.fbx',
  climb: 'Climbing Up Wall.fbx', pull: 'New animation 2/Climbing.fbx', descend: 'Climbing Down Wall.fbx'
};
const oneShot = new Set(['jump', 'jumpRun', 'wallJump', 'runStop', 'turn', 'runTurn', 'roll', 'heavy', 'slide', 'climb', 'pull', 'descend']);
const fades = { jump: .08, jumpRun: .08, wallJump: .08, airborne: .18, runStop: .12, turn: .12, runTurn: .12, roll: .08, heavy: .06, slide: .08, slideHold: .1, climb: .13, pull: .16, descend: .15, hang: .13, hangAlt: .35, run: .14 };

export class CharacterAnimations {
  constructor(scene, onProgress, settings) { this.scene = scene; this.onProgress = onProgress; this.settings=settings; this.actions = {}; this.missing = []; this.active = ''; this.model = null; }
  async load() {
    const loader = new FBXLoader();
    const load = path => new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
    const model = await load(`${import.meta.env.BASE_URL}assets/Y Bot.fbx`);
    const bounds = new THREE.Box3().setFromObject(model);
    const height = bounds.getSize(new THREE.Vector3()).y;
    const scale = 1.8 / height;
    model.scale.multiplyScalar(scale);
    model.position.y = -bounds.min.y * scale - .9;
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.root = new THREE.Group();
    this.flipPivot = new THREE.Group(); this.flipPivot.position.y = .9;
    this.flipPivot.add(model); this.root.add(this.flipPivot); this.scene.add(this.root); this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    const entries = Object.entries(files);
    for (let i = 0; i < entries.length; i++) {
      const [state, file] = entries[i]; this.onProgress?.(`${i + 1}/${entries.length}: ${file}`);
      try {
        const source = await load(`${import.meta.env.BASE_URL}assets/animations/` + file.split('/').map(encodeURIComponent).join('/'));
        let clip = source.animations[0];
        if (!clip) throw new Error('нет клипа');
        // All world translation belongs to the physical controller, never to an FBX root track.
        clip = clip.clone();
        const rootTrack=clip.tracks.find(t=>/^(?:mixamorig:?)?(?:Hips|Root)\.position$/i.test(t.name));
        const rootMotion=rootTrack?{track:rootTrack,interpolant:rootTrack.createInterpolant(),start:rootTrack.values.slice(0,3),end:rootTrack.values.slice(-3)}:null;
        clip.tracks = clip.tracks.filter(t => t!==rootTrack);
        if(state==='slide'&&rootTrack){
          // Keep the slide's crouch (vertical hips motion), while the controller owns travel.
          for(let j=0;j<rootTrack.values.length;j+=3){rootTrack.values[j]=rootMotion.start[0];rootTrack.values[j+2]=rootMotion.start[2];}
          clip.tracks.push(rootTrack);
        }
        if(state==='turn'||state==='runTurn'){
          // The physics facing drives the turn; keep the clip's footwork without rotating twice.
          const hips=clip.tracks.find(t=>/^(?:mixamorig:?)?Hips\.quaternion$/i.test(t.name));
          if(hips){const q=new THREE.Quaternion(),yawQ=new THREE.Quaternion(),forward=new THREE.Vector3();
            for(let j=0;j<hips.values.length;j+=4){q.fromArray(hips.values,j);forward.set(0,0,1).applyQuaternion(q);
              yawQ.setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.atan2(forward.x,forward.z));q.premultiply(yawQ).normalize().toArray(hips.values,j);}}
        }
        const action = this.mixer.clipAction(clip); action.setLoop(oneShot.has(state) ? THREE.LoopOnce : THREE.LoopRepeat); action.clampWhenFinished = oneShot.has(state);
        this.actions[state] = { action, file, clip: clip.name, duration: clip.duration, tracks: clip.tracks.length, rootMotion, nominalSpeed:rootMotion?Math.abs(rootMotion.end[2]-rootMotion.start[2])*scale/clip.duration:0 };
        if(state==='slide'){
          const still=clip.tracks.map(track=>{const value=Array.from(track.createInterpolant().evaluate(clip.duration*.56));
            return new track.constructor(track.name,[0,.25],[...value,...value]);});
          const hold=new THREE.AnimationClip('slideHold',.25,still),holdAction=this.mixer.clipAction(hold);
          holdAction.setLoop(THREE.LoopRepeat);this.actions.slideHold={action:holdAction,file,clip:hold.name,duration:hold.duration,tracks:still.length};
        }
      } catch (error) { this.missing.push(`${state}: ${file} (${error.message})`); }
    }
    this.play('idle'); return { height, scale, clips: this.actions, missing: this.missing };
  }
  play(state, speed = 1, restart = false) {
    const next = this.actions[state] || this.actions.idle; if (!next) return;
    if (this.active !== state) {
      const previous = this.actions[this.active]?.action;
      next.action.reset().setEffectiveWeight(1).play();
      if (previous) { previous.fadeOut(fades[state] ?? this.settings.fade); next.action.fadeIn(fades[state] ?? this.settings.fade); }
      this.active = state;
    } else if(restart) next.action.reset().play();
    next.action.setEffectiveTimeScale(speed);
  }
  update(dt) { this.mixer?.update(dt); }
  verticalProgress(state, progress) {
    const item=this.actions[state],motion=item?.rootMotion;
    if(!motion)return progress;
    const distance=motion.end[1]-motion.start[1];
    if(Math.abs(distance)<.001)return progress;
    const y=motion.interpolant.evaluate(THREE.MathUtils.clamp(progress,0,1)*item.duration)[1];
    return (y-motion.start[1])/distance;
  }
  get info() { const a = this.actions[this.active]; return a ? `${this.active}: ${a.file} · ${a.clip}` : 'нет клипа'; }
}
