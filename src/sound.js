export class SoundSystem {
  constructor(settings) {this.settings=settings;this.context=null;this.buffers={};this.decoded=new Map();this.last={};this.stepTime=0;}
  async unlock() {if(!this.context)this.context=new AudioContext();await this.context.resume();}
  async load() {
    const list={step:Array.from({length:10},(_,i)=>`footstep${String(i).padStart(2,'0')}.ogg`),jump:['cloth1.ogg'],land:['dropLeather.ogg'],roll:['cloth2.ogg'],slide:['cloth3.ogg'],climb:['cloth4.ogg'],heavy:['dropLeather.ogg']};
    for(const [key,files] of Object.entries(list)) this.buffers[key]=files.map(file=>`${import.meta.env.BASE_URL}assets/sounds/${file}`);
  }
  play(key) {if(!this.context||!this.buffers[key]||this.settings.volume===0)return;
    const now=performance.now();if(now-(this.last[key]||0)<120)return;this.last[key]=now;
    const paths=this.buffers[key],path=paths[Math.floor(Math.random()*paths.length)];
    if(!this.decoded.has(path))this.decoded.set(path,fetch(path).then(r=>r.arrayBuffer()).then(b=>this.context.decodeAudioData(b)));
    this.decoded.get(path).then(buffer=>{
      const src=this.context.createBufferSource(),gain=this.context.createGain();gain.gain.value=this.settings.volume*this.settings.movementVolume;
      src.buffer=buffer;src.connect(gain).connect(this.context.destination);src.start();
    }).catch(()=>{});
  }
  footsteps(dt,speed,grounded){if(!grounded||speed<.5){this.stepTime=0;return;}this.stepTime+=dt;const interval=speed>3.3?.32:.52;if(this.stepTime>=interval){this.stepTime=0;this.play('step');}}
}
