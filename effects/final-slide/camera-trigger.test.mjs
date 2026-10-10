import test from 'node:test';
import assert from 'node:assert/strict';
import {ArmSweep} from './arm-sweep.mjs';
import {CameraTrigger} from './camera-trigger.mjs';

// Synthetic image landmarks, not a substitute for a real camera/model check.
function pose(leftAngle = 0, rightAngle = leftAngle, {aspect = 4 / 3, roll = 0, mirror = false, bent = false} = {}) {
  const points = Array.from({length: 33}, () => ({x: .5, y: .7, visibility: .99, presence: .99}));
  const span = .18 * aspect, arm = span * 1.25, r = roll * Math.PI / 180;
  const put = (id, x, y) => {
    const px = .5 * aspect + x * Math.cos(r) - y * Math.sin(r);
    const py = .65 + x * Math.sin(r) + y * Math.cos(r);
    points[id] = {x: mirror ? 1 - px / aspect : px / aspect, y: py, visibility: .99, presence: .99};
  };
  for (const [s, e, w, sign, angle] of [[11,13,15,1,leftAngle],[12,14,16,-1,rightAngle]]) {
    const a = angle * Math.PI / 180, sx = sign * span / 2;
    const vx = sign * arm * Math.cos(a), vy = -arm * Math.sin(a);
    put(s, sx, 0); put(e, sx + vx * .5, vy * .5 + (bent ? arm * .32 : 0)); put(w, sx + vx, vy);
  }
  return points;
}
function sequence(detector, options = {}, transform = (p) => p) {
  const results = [];
  for (let t = 0; t <= 700; t += 100) results.push(detector.update(transform(pose(0,0,options),t), t, {width: options.aspect || 4/3,height:1}));
  for (let t = 800; t <= 2000; t += 100) {
    const angle = (t - 700) / 1300 * 90;
    results.push(detector.update(transform(pose(angle,angle,options),t), t, {width: options.aspect || 4/3,height:1}));
  }
  for (let t = 2100; t <= 2600; t += 100) results.push(detector.update(transform(pose(90,90,options),t), t, {width: options.aspect || 4/3,height:1}));
  return results;
}
function runAngles(angles) {
  const detector = new ArmSweep();
  return angles.map(([left,right],i) => detector.update(pose(left,right), i*100, {width:640,height:480}));
}
const triggers = results => results.filter(x => x.triggered).length;

test('a horizontal hold and broad coordinated sweep triggers exactly once', () => {
  const results = sequence(new ArmSweep());
  assert.equal(triggers(results), 1); assert.equal(results.at(-1).progress, 1);
});
test('mirroring, aspect ratio, and moderate camera roll preserve the gesture', () => {
  for (const options of [{mirror:true},{aspect:16/9},{aspect:1},{roll:20},{roll:-20,mirror:true}]) {
    assert.equal(triggers(sequence(new ArmSweep(), options)), 1, JSON.stringify(options));
  }
});
test('small angle jitter and slightly different arm timing remain usable', () => {
  const d=new ArmSweep(), results=[];
  for(let i=0;i<32;i++){
    const angle=i<8?0:Math.min(90,(i-8)*6);
    results.push(d.update(pose(angle+(i%2?2:-2),Math.max(0,angle-8)),i*100,{width:640,height:480}));
  }
  assert.equal(triggers(results),1);
});
test('static overhead, one arm, descending arms, and crossed arms do not trigger', () => {
  for(const angles of [Array(40).fill([90,90]),Array(40).fill([0,90]),
    Array.from({length:40},(_,i)=>[90-i*2,90-i*2]),Array(40).fill([180,180])]) assert.equal(triggers(runAngles(angles)),0);
});
test('horizontal directly to overhead does not satisfy the swept path', () => {
  assert.equal(triggers(runAngles([...Array(8).fill([0,0]),...Array(20).fill([90,90])])),0);
});
test('bent elbows and cropped/low-confidence wrists never arm', () => {
  assert.equal(triggers(sequence(new ArmSweep(),{bent:true})),0);
  for(const patch of [{visibility:.3},{presence:.2},{x:1.04}]) {
    assert.equal(triggers(sequence(new ArmSweep(),{},p=>{Object.assign(p[15],patch);return p;})),0);
  }
});
test('missing a pose for more than350ms requires a new horizontal hold', () => {
  const d=new ArmSweep();
  const results=sequence(d,{},(p,t)=>t>=1100&&t<=1500?undefined:p);
  assert.equal(triggers(results),0);
  d.reset(); assert.equal(triggers(sequence(d)),1);
});
test('brief tracking dropout is tolerated without crediting missing hold time', () => {
  assert.equal(triggers(sequence(new ArmSweep(),{},(p,t)=>t===1200?undefined:p)),1);
});
test('large reversal, asynchronous arms, and an overly slow sweep reset', () => {
  assert.equal(triggers(runAngles([...Array(8).fill([0,0]),[25,25],[45,45],[10,10],...Array(20).fill([90,90])])),0);
  assert.equal(triggers(runAngles([...Array(8).fill([0,0]),[20,0],[40,0],[60,30],[90,90],...Array(10).fill([90,90])])),0);
  const d=new ArmSweep(),r=[];
  for(let i=0;i<140;i++)r.push(d.update(pose(i<8?0:Math.min(90,(i-8)*.9)),i*100,{width:640,height:480}));
  assert.equal(triggers(r),0);
});
test('stale samples, changed body scale, and reset cannot reuse an armed gesture', () => {
  const d=new ArmSweep(); for(let t=0;t<=700;t+=100)d.update(pose(),t,{width:640,height:480});
  assert.equal(d.update(pose(90),1600,{width:640,height:480}).triggered,false);
  assert.equal(d.phase,'idle');
  d.reset(); assert.equal(triggers(runAngles(Array(20).fill([90,90]))),0);
  assert.equal(triggers(sequence(new ArmSweep(),{},(p,t)=>t<800?p:p.map(q=>({...q,x:.5+(q.x-.5)*.5,y:.65+(q.y-.65)*.5})))),0);
});

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function harness({permission,model}={}) {
  const document=new EventTarget(),window=new EventTarget(),video=new EventTarget(),track=new EventTarget();
  let now=0,id=0,detected=0,closed=0,stopped=0,fired=0,currentPose=pose();
  const callbacks=new Map(), statuses=[];
  track.stop=()=>{stopped++;};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  Object.assign(window,{isSecureContext:true,performance:{now:()=>now},
    requestAnimationFrame:fn=>{callbacks.set(++id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id),
    navigator:{mediaDevices:{getUserMedia:options=>{assert.equal(options.audio,false);return permission?.promise||Promise.resolve(stream);}}}});
  Object.assign(document,{defaultView:window,hidden:false});
  Object.assign(video,{ownerDocument:document,readyState:2,videoWidth:640,videoHeight:480,currentTime:0,
    play:()=>Promise.resolve(),pause:()=>{},srcObject:null});
  const recognizer={detectForVideo:()=>{detected++;return{landmarks:currentPose?[currentPose]:[]};},close:()=>{closed++;}};
  class FakeCamera extends CameraTrigger {
    async _loadRecognizer(session){
      const r=await(model?.promise||Promise.resolve(recognizer));
      if(!this._isCurrent(session)){r.close();throw new DOMException('Cancelled','AbortError');}return r;
    }
  }
  const camera=new FakeCamera({video,onTrigger:()=>{fired++;},onStatus:(text,code)=>statuses.push({text,code})});
  return {camera,document,window,video,stream,recognizer,statuses,
    get stats(){return{detected,closed,stopped,fired,raf:callbacks.size};},
    step(t,p=pose()){now=t;currentPose=p;video.currentTime=t/1000;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(now));}};
}
function cameraSweep(h,start=600){
  for(let i=0;i<8;i++)h.step(start+i*100,pose());
  for(let i=1;i<=13;i++)h.step(start+700+i*100,pose(i/13*90));
  for(let i=1;i<=6;i++)h.step(start+2000+i*100,pose(90));
}
test('camera triggers once, keeps tracks alive, and reenabling requires a fresh horizontal sequence',async()=>{
  const h=harness();assert.equal(await h.camera.start(),true);cameraSweep(h);
  assert.equal(h.stats.fired,1);assert.equal(h.stats.stopped,0);assert.equal(h.camera.active,true);
  const count=h.stats.detected;h.step(3400,pose(90));assert.equal(h.stats.detected,count);
  h.camera.setEnabled(true);for(let t=4000;t<=5000;t+=100)h.step(t,pose(90));assert.equal(h.stats.fired,1);
  cameraSweep(h,5100);assert.equal(h.stats.fired,2);
  h.camera.stop();assert.equal(h.stats.stopped,1);assert.equal(h.stats.closed,1);assert.equal(h.stats.raf,0);
});
test('disabled pending startup leaves video on and runs no inference until reenabled',async()=>{
  const permission=deferred(),h=harness({permission});const pending=h.camera.start();h.camera.setEnabled(false);
  permission.resolve(h.stream);assert.equal(await pending,true);for(let t=1000;t<=9000;t+=100)h.step(t);
  assert.equal(h.stats.detected,0);assert.equal(h.stats.stopped,0);assert.equal(h.camera.active,true);
  h.camera.setEnabled(true);cameraSweep(h,9600);assert.equal(h.stats.fired,1);h.camera.dispose();
});
test('disabling from a progress callback suppresses a result already computed that frame',async()=>{
  const h=harness();h.camera.onProgress=progress=>{if(progress===1)h.camera.setEnabled(false);};
  await h.camera.start();cameraSweep(h);assert.equal(h.stats.fired,0);assert.equal(h.stats.stopped,0);h.camera.dispose();
});
test('cancelled permission grants release late tracks and never resurrect the session',async()=>{
  const permission=deferred(),h=harness({permission});const pending=h.camera.start();h.camera.stop();
  assert.equal(await pending,false);permission.resolve(h.stream);await Promise.resolve();await Promise.resolve();
  assert.equal(h.stats.stopped,1);assert.equal(h.camera.active,false);assert.equal(h.stats.raf,0);
});
test('a late model result is closed after cancellation',async()=>{
  const model=deferred(),h=harness({model});const pending=h.camera.start();
  for(let i=0;i<8;i++)await Promise.resolve();h.camera.stop();model.resolve(h.recognizer);
  assert.equal(await pending,false);await Promise.resolve();assert.equal(h.stats.closed,1);assert.equal(h.stats.stopped,1);
});
test('visibility, permission denial, and dispose stop safely',async()=>{
  const h=harness();await h.camera.start();h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.stats.stopped,1);assert.equal(h.stats.raf,0);h.camera.dispose();assert.equal(await h.camera.start(),false);
  const permission=deferred(),denied=harness({permission});const pending=denied.camera.start();permission.reject(new DOMException('Denied','NotAllowedError'));
  assert.equal(await pending,false);assert.equal(denied.camera.active,false);assert.match(denied.statuses.at(-1).text,/not allowed/);
});
