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
    this.actionTime=0; this.actionDuration=0; this.actionFrom=v(); this.actionTo=v(); this.ledge=null; this.grabBlocked=false; this.obstacle='нет'; this.lastCheckpoint=v(0,.02,4);
    this.motionClip=null;this.motionTime=0;this.motionDuration=0;this.wasMoving=false;this.lastDirection=v();
    this.body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x,this.pos.y+this.height/2,this.pos.z));
    this.collider=world.createCollider(RAPIER.ColliderDesc.capsule((this.height-2*this.radius)/2,this.radius),this.body);
    this.controller=world.createCharacterController(.025); this.controller.setApplyImpulsesToDynamicBodies(false); this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(45*Math.PI/180); this.controller.setMinSlopeSlideAngle(50*Math.PI/180);
    this.controller.enableAutostep(.23,.2,false); this.controller.enableSnapToGround(.18);
  }
  teleport(point) { this.pos.set(point[0],point[1]+.02,point[2]);this.velocity.set(0,0,0);this.ledge=null;this.grabBlocked=false;this.actionTime=0;this.motionTime=0;this.wasMoving=false;this.lastDirection.set(0,0,0);this.state='idle';this.jumpCount=0;this.flipTime=0;this.flipPhase=0;this.body.setNextKinematicTranslation({x:this.pos.x,y:this.pos.y+this.height/2,z:this.pos.z}); }
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
  #nearLedge(heading) {
    let best=null;
    for(const o of this.obstacles){
      if(!o.ledge || o.top-this.pos.y<.4 || o.top-this.pos.y>3.05)continue;
      for(const face of [
        {normal:v(-1,0,0),distance:o.x-o.w/2-this.pos.x,tangent:this.pos.z-o.z,limit:o.d/2,anchor:v(o.x-o.w/2,o.top,clamp(this.pos.z,o.z-o.d/2,o.z+o.d/2))},
        {normal:v(1,0,0),distance:this.pos.x-o.x-o.w/2,tangent:this.pos.z-o.z,limit:o.d/2,anchor:v(o.x+o.w/2,o.top,clamp(this.pos.z,o.z-o.d/2,o.z+o.d/2))},
        {normal:v(0,0,-1),distance:o.z-o.d/2-this.pos.z,tangent:this.pos.x-o.x,limit:o.w/2,anchor:v(clamp(this.pos.x,o.x-o.w/2,o.x+o.w/2),o.top,o.z-o.d/2)},
        {normal:v(0,0,1),distance:this.pos.z-o.z-o.d/2,tangent:this.pos.x-o.x,limit:o.w/2,anchor:v(clamp(this.pos.x,o.x-o.w/2,o.x+o.w/2),o.top,o.z+o.d/2)}
      ]){
        // The character must be outside this face and looking towards it.
        if(face.distance<-.08 || face.distance>.78 || Math.abs(face.tangent)>face.limit+this.radius || heading.dot(face.normal)>-.2)continue;
        const score=face.distance+Math.abs(face.tangent)*.02;
        if(!best||score<best.score)best={obstacle:o,normal:face.normal,anchor:face.anchor,score};
      }
    }
    return best;
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
  #playMotion(state,duration){this.motionClip=state;this.motionTime=duration;this.motionDuration=duration;
    const clip=this.animations.actions[state];this.animations.play(state,clip?clip.duration/duration:1,true);}
  #startAction(state,to,duration) {this.state=state;this.actionFrom.copy(this.pos);this.actionTo.copy(to);this.actionDuration=duration;this.actionTime=duration;this.motionTime=0;this.velocity.set(0,0,0);this.sound.play(state==='landing'?'roll':state==='pull'?'climb':state);
    const animationState=state==='landing'?'roll':state;const clip=this.animations.actions[animationState];
    if(clip)this.animations.play(animationState,clip.duration/duration,true);}
  #grabLedge(input,dir) {
    if(!input.shift || this.grabBlocked || input.descend)return false;
    const heading=dir.lengthSq()>.01?dir.clone().normalize():v(-Math.sin(this.facing),0,-Math.cos(this.facing));
    const hit=this.#nearLedge(heading);this.obstacle=hit?.obstacle.kind||'нет';
    if(!hit || !this.#changeCrouch(false))return false;
    const {obstacle:o,normal,anchor}=hit, inward=normal.clone().negate();
    const landing=this.#landingPoint(o,anchor,inward);
    if(!this.#topClear(landing))return false;
    this.ledge={obstacle:o,dir:inward,anchor,entering:true,hangTime:0};
    const outside=anchor.clone().addScaledVector(normal,this.radius+.06);
    const target=v(outside.x,o.top-this.height,outside.z);
    this.#startAction('climb',target,clamp(Math.abs(target.y-this.pos.y)/1.4,.32,1.25));
    this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.wasMoving=false;return true;
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
    point.y=o.top-this.height;
    const anchor=alongX?v(o.x+face*o.w/2,o.top,this.pos.z):v(this.pos.x,o.top,o.z+face*o.d/2);
    this.ledge={obstacle:o,dir:alongX?v(-face,0,0):v(0,0,-face),anchor,entering:true,hangTime:0};
    this.#startAction('descend',point,1.35);this.grounded=false;this.coyote=0;return true;
  }
  #ledgeStep(dt,input) {
    const o=this.ledge.obstacle, dir=this.ledge.dir, lateral=v(-dir.z,0,dir.x);
    if(input.release) {this.ledge=null;this.grabBlocked=true;this.state='airborne';this.velocity.y=-1;this.coyote=0;return;}
    if(input.back&&input.jumpPressed){this.ledge=null;this.grabBlocked=true;this.state='wallJump';this.grounded=false;this.coyote=0;this.jumpCount=1;
      this.velocity.copy(dir).multiplyScalar(-4.5);this.velocity.y=6.2;this.#playMotion('wallJump',.7);this.sound.play('jump');return;}
    this.ledge.hangTime+=dt;
    const step=(Number(input.right)-Number(input.left))*dt*1.25;
    const candidate=this.pos.clone().addScaledVector(lateral,step);
    const within=Math.abs(dir.x)>Math.abs(dir.z)?Math.abs(candidate.z-o.z)<o.d/2-this.radius:Math.abs(candidate.x-o.x)<o.w/2-this.radius;
    if(within){this.pos.copy(candidate);this.ledge.anchor.addScaledVector(lateral,step);}
    if(!input.forward)this.ledge.entering=false;
    if((input.forward&&!this.ledge.entering) || input.jumpPressed) {
      const to=this.#landingPoint(o,this.ledge.anchor,dir);
      if(this.#topClear(to)){this.ledge=null;this.#startAction('pull',to,2.05);} }
    this.#commit();
  }
  #commit() {this.body.setNextKinematicTranslation({x:this.pos.x,y:this.pos.y+this.height/2,z:this.pos.z});}
  step(dt,input,cameraYaw) {
    if(this.pos.y< -12){this.reset();return;}
    if(!input.shift)this.grabBlocked=false;
    if(this.motionTime>0)this.motionTime=Math.max(0,this.motionTime-dt);
    if(this.flipTime>0){this.flipTime=Math.max(0,this.flipTime-dt);this.flipPhase=this.flipTime>0?1-this.flipTime/this.flipDuration:0;}
    if(this.ledge&&input.release&&(this.state==='climb'||this.state==='descend')){this.ledge=null;this.grabBlocked=true;this.actionTime=0;this.state='airborne';this.velocity.y=-1;}
    if(this.actionTime>0){
      this.actionTime=Math.max(0,this.actionTime-dt);const t=1-this.actionTime/this.actionDuration;
      const desired=this.actionFrom.clone().lerp(this.actionTo,t);
      if(this.state==='pull'){
        const up=this.animations.verticalProgress('pull',t),across=clamp((t-.72)/.24,0,1);
        const acrossEase=across*across*(3-2*across);
        desired.x=THREE.MathUtils.lerp(this.actionFrom.x,this.actionTo.x,acrossEase);
        desired.z=THREE.MathUtils.lerp(this.actionFrom.z,this.actionTo.z,acrossEase);
        desired.y=THREE.MathUtils.lerp(this.actionFrom.y,this.actionTo.y,up);
      }
      if(this.state==='descend'){
        const across=clamp(t/.28,0,1),down=clamp((t-.28)/.72,0,1);
        const acrossEase=across*across*(3-2*across),downEase=down*down*(3-2*down);
        desired.x=THREE.MathUtils.lerp(this.actionFrom.x,this.actionTo.x,acrossEase);
        desired.z=THREE.MathUtils.lerp(this.actionFrom.z,this.actionTo.z,acrossEase);
        desired.y=THREE.MathUtils.lerp(this.actionFrom.y,this.actionTo.y,downEase);
      }
      this.controller.computeColliderMovement(this.collider,{x:desired.x-this.pos.x,y:desired.y-this.pos.y,z:desired.z-this.pos.z});
      const move=this.controller.computedMovement();this.pos.add(v(move.x,move.y,move.z));this.#commit();
      const animationState=this.state==='landing'?'roll':this.state;
      const clip=this.animations.actions[animationState];this.animations.play(animationState,clip?clip.duration/this.actionDuration:1);
      if(this.actionTime===0){
        if((this.state==='climb'||this.state==='descend')&&this.ledge){this.state='hang';this.ledge.entering=false;}
        else this.state='idle';
      }
      return;
    }
    if(this.ledge){this.#ledgeStep(dt,input);if(this.state==='hang')this.animations.play(this.ledge.hangTime>3.5?'hangAlt':'hang');return;}
    if(input.toggleCrouch&&this.grounded){const wasCrouched=this.crouch;if(this.#changeCrouch(!this.crouch)&&wasCrouched)this.#playMotion('stand',.65);}
    const forward=v(-Math.sin(cameraYaw),0,-Math.cos(cameraYaw)); const right=v(Math.cos(cameraYaw),0,-Math.sin(cameraYaw));
    const direction=forward.multiplyScalar(Number(input.forward)-Number(input.back)).addScaledVector(right,Number(input.right)-Number(input.left));
    if(direction.lengthSq()>1) direction.normalize();
    const moving=direction.lengthSq()>.01,previousSpeed=Math.hypot(this.velocity.x,this.velocity.z);
    if(this.grounded&&!this.crouch){
      if(!moving&&this.wasMoving&&previousSpeed>3)this.#playMotion('runStop',.55);
      else if(moving&&!this.wasMoving&&!input.shift&&previousSpeed<1)this.#playMotion('walkStart',.75);
      else if(moving&&this.wasMoving&&previousSpeed>2.5&&this.lastDirection.lengthSq()>.1&&this.motionTime===0){
        const dot=this.lastDirection.dot(direction.clone().normalize());
        if(dot<.35)this.#playMotion(dot<-.55?'turn':'runTurn',.72);
      }
    }
    this.wasMoving=moving;
    if(moving)this.lastDirection.copy(direction).normalize();
    const speed=this.crouch?this.settings.crouchSpeed:input.shift?this.settings.runSpeed:this.settings.walkSpeed;
    const target=direction.clone().multiplyScalar(speed);const responsiveness=this.grounded?14:3;
    this.velocity.x+=clamp(target.x-this.velocity.x,-responsiveness*dt,responsiveness*dt);
    this.velocity.z+=clamp(target.z-this.velocity.z,-responsiveness*dt,responsiveness*dt);
    if(moving){const targetYaw=Math.atan2(-direction.x,-direction.z),turning=this.motionTime>0&&(this.motionClip==='turn'||this.motionClip==='runTurn');
      this.facing+=Math.atan2(Math.sin(targetYaw-this.facing),Math.cos(targetYaw-this.facing))*Math.min(1,dt*(turning?5:11));}
    if(input.jumpPressed)this.jumpBuffer=.1;else this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    this.coyote=this.grounded?.1:Math.max(0,this.coyote-dt);
    if(this.jumpBuffer>0 && this.coyote>0 && this.#changeCrouch(false)){
      this.velocity.y=input.shift?7.1:6.6;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.jumpCount=1;this.state='jump';this.fallStart=this.pos.y;this.sound.play('jump');
      if(previousSpeed>2.8)this.#playMotion('jumpRun',.58);else this.motionTime=0;
    }else if(input.jumpPressed&&!this.grounded&&this.jumpCount===1){
      this.velocity.y=6.4;this.jumpBuffer=0;this.jumpCount=2;this.flipTime=this.flipDuration;this.flipPhase=0;this.state='doubleJump';this.motionTime=0;
      this.animations.play('airborne',1,true);this.sound.play('jump');
    }
    if((this.grounded&&this.#tryDescend(input,direction))||this.#grabLedge(input,direction)) {this.#commit();return;}
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
    else this.state=horizontal<.2?'idle':horizontal<3.3?'walk':input.shift?'sprint':'run';
    let animationState=this.state==='doubleJump'?'airborne':this.state;
    const keepMotion=this.motionTime>0&&(
      ((this.motionClip==='jumpRun'||this.motionClip==='wallJump')&&!this.grounded)||
      (this.motionClip==='walkStart'&&this.grounded&&moving&&!input.shift)||
      (this.motionClip==='runStop'&&this.grounded&&!moving)||
      ((this.motionClip==='turn'||this.motionClip==='runTurn')&&this.grounded&&moving)||
      (this.motionClip==='stand'&&this.grounded&&!this.crouch&&!moving));
    if(keepMotion)animationState=this.motionClip;else this.motionTime=0;
    this.animations.play(animationState,keepMotion?this.animations.actions[animationState].duration/this.motionDuration:this.state==='walk'?clamp(horizontal/2,.65,1.4):this.state==='run'||this.state==='sprint'?clamp(horizontal/5,.7,1.25):1);
    this.animations.root?.position.copy(this.pos);if(this.animations.root)this.animations.root.rotation.y=this.facing;
    this.sound.footsteps(dt,horizontal,this.grounded,this.crouch);
  }
}
