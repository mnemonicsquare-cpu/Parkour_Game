import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const v = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const clamp = THREE.MathUtils.clamp;
export class Player {
  constructor(world, obstacles, animations, settings, sound) {
    this.world=world; this.obstacles=obstacles; this.animations=animations; this.settings=settings; this.sound=sound;
    this.height=1.8; this.radius=.28; this.pos=v(0,.02,4); this.velocity=v(); this.facing=0;
    this.state='idle'; this.grounded=false; this.crouch=false; this.fallStart=0; this.fallHeight=0; this.coyote=0; this.jumpBuffer=0;
    this.jumpCount=0;this.flipDuration=.72;this.flipTime=0;this.flipPhase=0;
    this.actionTime=0; this.actionDuration=0; this.actionFrom=v(); this.actionTo=v(); this.ledge=null; this.obstacle='нет'; this.lastCheckpoint=v(0,.02,4);
    this.body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x,this.pos.y+this.height/2,this.pos.z));
    this.collider=world.createCollider(RAPIER.ColliderDesc.capsule((this.height-2*this.radius)/2,this.radius),this.body);
    this.controller=world.createCharacterController(.025); this.controller.setApplyImpulsesToDynamicBodies(false); this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(45*Math.PI/180); this.controller.setMinSlopeSlideAngle(50*Math.PI/180);
    this.controller.enableAutostep(.23,.2,false); this.controller.enableSnapToGround(.18);
  }
  teleport(point) { this.pos.set(point[0],point[1]+.02,point[2]);this.velocity.set(0,0,0);this.ledge=null;this.actionTime=0;this.state='idle';this.jumpCount=0;this.flipTime=0;this.flipPhase=0;this.body.setNextKinematicTranslation({x:this.pos.x,y:this.pos.y+this.height/2,z:this.pos.z}); }
  reset() { this.teleport(this.lastCheckpoint.toArray()); }
  setCheckpoint(point) { this.lastCheckpoint.set(...point); this.teleport(point); }
  #changeCrouch(value){
    if(value===this.crouch)return true;
    if(!value){const ceiling=this.world.castRay(new RAPIER.Ray({x:this.pos.x,y:this.pos.y+1.2,z:this.pos.z},{x:0,y:1,z:0}),.7,true,undefined,undefined,this.collider);
      if(ceiling)return false;
    }
    this.crouch=value;const currentHeight=value?1.2:this.height;
    if(!value)this.pos.y+=.04;
    this.world.removeCollider(this.collider,true);
    this.collider=this.world.createCollider(RAPIER.ColliderDesc.capsule((currentHeight-2*this.radius)/2,this.radius),this.body);
    this.collider.setTranslation({x:0,y:(currentHeight-this.height)/2,z:0});return true;
  }
  #nearObstacle(dir) {
    const origin={x:this.pos.x,y:this.pos.y+.38,z:this.pos.z};
    const ray=new RAPIER.Ray(origin,{x:dir.x,y:0,z:dir.z});
    const hit=this.world.castRay(ray,.9,true,undefined,undefined,this.collider);
    if(!hit) return null;
    const point=ray.pointAt(hit.timeOfImpact); const obj=hit.collider.userData;
    return obj ? {obj,point,distance:hit.timeOfImpact} : null;
  }
  #landingPoint(obj,face,dir){
    const marginX=Math.min(this.radius+.05,obj.w/2-.02),marginZ=Math.min(this.radius+.05,obj.d/2-.02);
    return v(clamp(face.x+dir.x*(this.radius+.18),obj.x-obj.w/2+marginX,obj.x+obj.w/2-marginX),
      obj.top+.03,clamp(face.z+dir.z*(this.radius+.18),obj.z-obj.d/2+marginZ,obj.z+obj.d/2-marginZ));
  }
  #topClear(point) {
    const shape=new RAPIER.Capsule((this.height-2*this.radius)/2,this.radius);
    return !this.world.intersectionWithShape({x:point.x,y:point.y+this.height/2+.1,z:point.z},{x:0,y:0,z:0,w:1},shape,undefined,undefined,this.collider);
  }
  #startAction(state,to,duration) {this.state=state;this.actionFrom.copy(this.pos);this.actionTo.copy(to);this.actionDuration=duration;this.actionTime=duration;this.velocity.set(0,0,0);this.sound.play(state==='landing'?'roll':state==='pull'?'climb':state);
    if(state==='pull'){const clip=this.animations.actions.climb;this.animations.play('climb',clip?clip.duration/duration:1,true);}}
  #parkour(input,dir) {
    if (!input.shift || !input.forward || dir.lengthSq()<.1) return false;
    const hit=this.#nearObstacle(dir); this.obstacle=hit?.obj.kind || 'нет'; if(!hit) return false;
    const o=hit.obj, rise=o.top-this.pos.y;
    if(!o.ledge || rise<.3 || rise>2.5 || !this.#changeCrouch(false)) return false;
    const landing=this.#landingPoint(o,hit.point,dir);
    if(!this.#topClear(landing))return false;
    if(rise<=.9) {const depth=Math.abs(dir.x)*o.w+Math.abs(dir.z)*o.d;
      const farSide=v(hit.point.x+dir.x*(depth+this.radius+.1),o.top+.03,hit.point.z+dir.z*(depth+this.radius+.1));
      this.#startAction('vault',farSide,.64);return true;}
    if(rise<=1.35 || input.jump) {this.#startAction('pull',landing,.92);return true;}
    this.ledge={obstacle:o,dir:dir.clone(),anchor:v(hit.point.x,o.top,hit.point.z),entering:true}; this.state='hang';this.pos.y=o.top-1.45;this.velocity.set(0,0,0);this.sound.play('climb');return true;
  }
  #tryDescend(input,dir){
    if(!input.descend || !input.shift || !this.grounded)return false;
    const heading=dir.lengthSq()>.1?dir.clone().normalize():v(-Math.sin(this.facing),0,-Math.cos(this.facing));
    const o=this.obstacles.find(o=>o.ledge&&Math.abs(this.pos.y-o.top)<.17&&Math.abs(this.pos.x-o.x)<o.w/2&&Math.abs(this.pos.z-o.z)<o.d/2);
    if(!o)return false;
    const alongX=Math.abs(heading.x)>Math.abs(heading.z);
    const face=alongX?Math.sign(heading.x):Math.sign(heading.z);
    const distance=alongX?o.w/2-face*(this.pos.x-o.x):o.d/2-face*(this.pos.z-o.z);
    if(distance>.65)return false;
    const point=this.pos.clone();if(alongX)point.x=o.x+face*(o.w/2+this.radius+.05);else point.z=o.z+face*(o.d/2+this.radius+.05);
    point.y=o.top-1.45;this.pos.copy(point);
    const anchor=alongX?v(o.x+face*o.w/2,o.top,this.pos.z):v(this.pos.x,o.top,o.z+face*o.d/2);
    this.ledge={obstacle:o,dir:alongX?v(face,0,0):v(0,0,face),anchor,entering:true};this.state='hang';this.velocity.set(0,0,0);this.sound.play('climb');return true;
  }
  #ledgeStep(dt,input) {
    const o=this.ledge.obstacle, dir=this.ledge.dir, lateral=v(-dir.z,0,dir.x);
    if(input.release) {this.ledge=null;this.state='airborne';this.velocity.y=-1;this.coyote=0;return;}
    const step=(Number(input.right)-Number(input.left))*dt*1.25;
    const candidate=this.pos.clone().addScaledVector(lateral,step);
    const within=Math.abs(dir.x)>Math.abs(dir.z)?Math.abs(candidate.z-o.z)<o.d/2-this.radius:Math.abs(candidate.x-o.x)<o.w/2-this.radius;
    if(within){this.pos.copy(candidate);this.ledge.anchor.addScaledVector(lateral,step);}
    if(!input.forward)this.ledge.entering=false;
    if((input.forward&&!this.ledge.entering) || input.jumpPressed) {
      const to=this.#landingPoint(o,this.ledge.anchor,dir);
      if(this.#topClear(to)){this.ledge=null;this.#startAction('pull',to,.98);} }
    this.#commit();
  }
  #commit() {this.body.setNextKinematicTranslation({x:this.pos.x,y:this.pos.y+this.height/2,z:this.pos.z});}
  step(dt,input,cameraYaw) {
    if(this.pos.y< -12){this.reset();return;}
    if(this.flipTime>0){this.flipTime=Math.max(0,this.flipTime-dt);this.flipPhase=this.flipTime>0?1-this.flipTime/this.flipDuration:0;}
    if(this.ledge){this.#ledgeStep(dt,input);this.animations.play(this.state==='pull'?'climb':'climb');return;}
    if(this.actionTime>0){
      this.actionTime=Math.max(0,this.actionTime-dt);const t=1-this.actionTime/this.actionDuration;
      const desired=this.actionFrom.clone().lerp(this.actionTo,t);
      if(this.state==='vault')desired.y+=Math.sin(Math.PI*t)*.4;
      if(this.state==='pull'){
        const up=clamp(t/.62,0,1),across=clamp((t-.62)/.38,0,1);
        const upEase=up*up*(3-2*up),acrossEase=across*across*(3-2*across);
        desired.x=THREE.MathUtils.lerp(this.actionFrom.x,this.actionTo.x,acrossEase);
        desired.z=THREE.MathUtils.lerp(this.actionFrom.z,this.actionTo.z,acrossEase);
        desired.y=THREE.MathUtils.lerp(this.actionFrom.y,this.actionTo.y+.08,upEase);
        if(t>.82)desired.y=THREE.MathUtils.lerp(this.actionTo.y+.08,this.actionTo.y,(t-.82)/.18);
      }
      this.controller.computeColliderMovement(this.collider,{x:desired.x-this.pos.x,y:desired.y-this.pos.y,z:desired.z-this.pos.z});
      const move=this.controller.computedMovement();this.pos.add(v(move.x,move.y,move.z));this.#commit();
      const animationState=this.state==='pull'?'climb':this.state==='landing'?'roll':this.state==='heavy'?'heavy':'vault';
      const clip=this.animations.actions[animationState];this.animations.play(animationState,clip?clip.duration/this.actionDuration:1);
      if(this.actionTime===0) this.state='idle';return;
    }
    if(input.toggleCrouch && this.grounded)this.#changeCrouch(!this.crouch);
    const forward=v(-Math.sin(cameraYaw),0,-Math.cos(cameraYaw)); const right=v(Math.cos(cameraYaw),0,-Math.sin(cameraYaw));
    const direction=forward.multiplyScalar(Number(input.forward)-Number(input.back)).addScaledVector(right,Number(input.right)-Number(input.left));
    if(direction.lengthSq()>1) direction.normalize();
    const speed=this.crouch?this.settings.crouchSpeed:input.shift?this.settings.runSpeed:this.settings.walkSpeed;
    const target=direction.clone().multiplyScalar(speed);const responsiveness=this.grounded?14:3;
    this.velocity.x+=clamp(target.x-this.velocity.x,-responsiveness*dt,responsiveness*dt);
    this.velocity.z+=clamp(target.z-this.velocity.z,-responsiveness*dt,responsiveness*dt);
    if(direction.lengthSq()>.01){const targetYaw=Math.atan2(-direction.x,-direction.z);this.facing+=Math.atan2(Math.sin(targetYaw-this.facing),Math.cos(targetYaw-this.facing))*Math.min(1,dt*11);}
    if(input.jumpPressed)this.jumpBuffer=.1;else this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    this.coyote=this.grounded?.1:Math.max(0,this.coyote-dt);
    if(this.jumpBuffer>0 && this.coyote>0 && this.#changeCrouch(false)){
      this.velocity.y=input.shift?7.1:6.6;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.jumpCount=1;this.state='jump';this.fallStart=this.pos.y;this.sound.play('jump');
    }else if(input.jumpPressed&&!this.grounded&&this.jumpCount===1){
      this.velocity.y=6.4;this.jumpBuffer=0;this.jumpCount=2;this.flipTime=this.flipDuration;this.flipPhase=0;this.state='doubleJump';
      this.animations.play('airborne',1,true);this.sound.play('jump');
    }
    if(this.grounded && (this.#tryDescend(input,direction)||this.#parkour(input,direction))) {this.#commit();return;}
    this.velocity.y=Math.max(-20,this.velocity.y-20*dt);
    this.controller.computeColliderMovement(this.collider,{x:this.velocity.x*dt,y:this.velocity.y*dt,z:this.velocity.z*dt});
    const movement=this.controller.computedMovement();const wasGrounded=this.grounded;this.grounded=this.controller.computedGrounded();
    this.pos.add(v(movement.x,movement.y,movement.z));
    if(this.grounded){
      this.jumpCount=0;this.flipTime=0;this.flipPhase=0;
      if(!wasGrounded){this.fallHeight=Math.max(0,this.fallStart-this.pos.y);this.sound.play('land');
        if(this.fallHeight>this.settings.heavyHeight){this.#startAction('heavy',this.pos.clone(),1.4);}
        else if(this.fallHeight>this.height && Math.hypot(this.velocity.x,this.velocity.z)>1.2){const rollDir=v(this.velocity.x,0,this.velocity.z).normalize();this.#startAction('landing',this.pos.clone().addScaledVector(rollDir,1.05),.72);}
      }
      this.velocity.y=0;this.fallStart=this.pos.y;
    } else if(wasGrounded) this.fallStart=this.pos.y;
    this.#commit();
    const horizontal=Math.hypot(this.velocity.x,this.velocity.z);
    if(this.actionTime>0)return;
    if(!this.grounded) this.state=this.flipTime>0?'doubleJump':this.velocity.y>1?'jump':'airborne';
    else if(this.crouch)this.state=horizontal>.25?'crouchWalk':'crouch';
    else this.state=horizontal<.2?'idle':horizontal<3.3?'walk':'run';
    this.animations.play(this.state==='doubleJump'?'airborne':this.state,this.state==='walk'?clamp(horizontal/2,.65,1.4):this.state==='run'?clamp(horizontal/5,.7,1.25):1);
    this.animations.root?.position.copy(this.pos);if(this.animations.root)this.animations.root.rotation.y=this.facing;
    this.sound.footsteps(dt,horizontal,this.grounded,this.crouch);
  }
}
