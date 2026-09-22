import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const files = {
  idle: 'Action Adventure Pack/idle.fbx', walk: 'Action Adventure Pack/walking.fbx', run: 'Action Adventure Pack/running.fbx',
  jump: 'Action Adventure Pack/jumping up.fbx', airborne: 'Action Adventure Pack/falling idle.fbx',
  roll: 'Action Adventure Pack/falling to roll.fbx', heavy: 'Action Adventure Pack/hard landing.fbx',
  crouch: 'Action Adventure Pack/stand to cover.fbx', crouchWalk: 'Action Adventure Pack/crouched sneaking left.fbx',
  stand: 'Action Adventure Pack/cover to stand.fbx', vault: 'Stand To Roll.fbx',
  climb: 'Climbing Up Wall.fbx', descend: 'Climbing Down Wall.fbx'
};
const oneShot = new Set(['jump', 'roll', 'heavy', 'crouch', 'stand', 'vault', 'climb', 'descend']);
const fades = { jump: .08, airborne: .18, roll: .08, heavy: .06, vault: .1, climb: .13, crouch: .22, stand: .22 };

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
    model.position.y = -bounds.min.y * scale;
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.root = new THREE.Group(); this.root.add(model); this.scene.add(this.root); this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    const entries = Object.entries(files);
    for (let i = 0; i < entries.length; i++) {
      const [state, file] = entries[i]; this.onProgress?.(`${i + 1}/${entries.length}: ${file}`);
      try {
        const source = await load(`${import.meta.env.BASE_URL}assets/animations/` + encodeURIComponent(file.split('/').pop()));
        let clip = source.animations[0];
        if (!clip) throw new Error('нет клипа');
        // All world translation belongs to the physical controller, never to an FBX root track.
        clip = clip.clone(); clip.tracks = clip.tracks.filter(t => !/^(?:mixamorig:?)?(?:Hips|Root)\.position$/i.test(t.name));
        const action = this.mixer.clipAction(clip); action.setLoop(oneShot.has(state) ? THREE.LoopOnce : THREE.LoopRepeat); action.clampWhenFinished = oneShot.has(state);
        this.actions[state] = { action, file, clip: clip.name, duration: clip.duration, tracks: clip.tracks.length };
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
  get info() { const a = this.actions[this.active]; return a ? `${this.active}: ${a.file} · ${a.clip}` : 'нет клипа'; }
}
