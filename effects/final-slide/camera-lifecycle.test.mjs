import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraTrigger} from './camera-trigger.mjs';
import {hands} from './hand-fixtures.mjs';

// Mocked camera lifecycle; real camera/model recognition is checked separately.
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function harness({permission,model}={}) {
  const document=new EventTarget(),window=new EventTarget(),video=new EventTarget(),track=new EventTarget();
  let now=0,id=0,detected=0,closed=0,stopped=0,fired=0,currentHands=hands();
  const callbacks=new Map(), statuses=[];
  track.stop=()=>{stopped++;};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  Object.assign(window,{isSecureContext:true,performance:{now:()=>now},
    requestAnimationFrame:fn=>{callbacks.set(++id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id),
    navigator:{mediaDevices:{getUserMedia:options=>{assert.equal(options.audio,false);return permission?.promise||Promise.resolve(stream);}}}});
  Object.assign(document,{defaultView:window,hidden:false});
  Object.assign(video,{ownerDocument:document,readyState:2,videoWidth:640,videoHeight:480,currentTime:0,
    play:()=>Promise.resolve(),pause:()=>{},srcObject:null});
  const recognizer={detectForVideo:()=>{detected++;return{landmarks:currentHands||[]};},close:()=>{closed++;}};
  class FakeCamera extends CameraTrigger {
    async _loadRecognizer(session){
      const r=await(model?.promise||Promise.resolve(recognizer));
      if(!this._isCurrent(session)){r.close();throw new DOMException('Cancelled','AbortError');}return r;
    }
  }
  const camera=new FakeCamera({video,onTrigger:()=>{fired++;},onStatus:(text,code)=>statuses.push({text,code})});
  return {camera,document,window,video,stream,recognizer,statuses,
    get stats(){return{detected,closed,stopped,fired,raf:callbacks.size};},
    step(t,p=hands()){now=t;currentHands=p;video.currentTime=t/1000;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(now));}};
}
function cameraSweep(h,start=600){
  for(let i=0;i<8;i++)h.step(start+i*100,hands());
  for(let i=1;i<=13;i++)h.step(start+700+i*100,hands(i/13));
  for(let i=1;i<=6;i++)h.step(start+2000+i*100,hands(1));
}
test('camera triggers once, keeps tracks alive, and reenabling requires a fresh horizontal sequence',async()=>{
  const h=harness();assert.equal(await h.camera.start(),true);cameraSweep(h);
  assert.equal(h.stats.fired,1);assert.equal(h.stats.stopped,0);assert.equal(h.camera.active,true);
  const count=h.stats.detected;h.step(3400,hands(1));assert.equal(h.stats.detected,count);
  h.camera.setEnabled(true);for(let t=4000;t<=5000;t+=100)h.step(t,hands(1));assert.equal(h.stats.fired,1);
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
test('stopping from the triggered status callback prevents a stale wave trigger',async()=>{
  const h=harness();h.camera.onStatus=(text,code)=>{if(code==='triggered')h.camera.stop();};
  await h.camera.start();cameraSweep(h);assert.equal(h.stats.fired,0);assert.equal(h.stats.stopped,1);
  assert.equal(h.camera.active,false);assert.equal(h.stats.raf,0);
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


test('camera forwards both detected hands and video dimensions to the detector', async () => {
  const h = harness();
  await h.camera.start();
  const sample = hands(.4);
  let observed;
  h.camera._session.detector.update = (landmarks, time, dimensions) => {
    observed = {landmarks, time, dimensions};
    return {phase: 'tracking', message: 'Tracking both hands.', progress: .4, triggered: false};
  };
  h.step(700, sample);
  assert.equal(observed.landmarks, sample);
  assert.equal(observed.landmarks.length, 2);
  assert.equal(observed.landmarks[0].length, 21);
  assert.equal(observed.landmarks[1].length, 21);
  assert.equal(observed.time, 700);
  assert.deepEqual(observed.dimensions, {width: 640, height: 480});
  h.camera.dispose();
});

test('inference errors release camera resources and report a hand-tracking failure', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const h = harness();
  await h.camera.start();
  h.recognizer.detectForVideo = () => {throw new Error('Inference unavailable');};
  h.step(700);
  assert.equal(h.camera.active, false);
  assert.equal(h.stats.stopped, 1);
  assert.equal(h.stats.closed, 1);
  assert.equal(h.stats.raf, 0);
  assert.match(h.statuses.at(-1).text, /Hand tracking stopped/);
  assert.equal(warnings.length, 1);
});
