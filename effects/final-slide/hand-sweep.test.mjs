import test from 'node:test';
import assert from 'node:assert/strict';
import {HandSweep} from './hand-sweep.mjs';
import {hands} from './hand-fixtures.mjs';
const count=results=>results.filter(x=>x.triggered).length;
function sequence(options={},transform=(pair)=>pair,{duration=800,step=100}={}) {
  const d=new HandSweep(),r=[];
  const update=(p,t)=>r.push(d.update(transform(hands(p,options),t),t,{width:options.aspect||4/3,height:1}));
  for(let t=0;t<=600;t+=step)update(0,t);
  for(let t=600+step;t<=600+duration;t+=step)update(Math.min(1,(t-600)/duration),t);
  for(let t=600+duration+step;t<=600+duration+600;t+=step)update(1,t);
  return r;
}
test('a normal clap with upright fingers triggers once before contact',()=>{
  const r=sequence();assert.equal(count(r),1);assert.equal(r.at(-1).phase,'complete');
});
test('claps at different speeds, mirrored camera and hand output order work',()=>{
  for(const duration of [300,500,1000,1400])assert.equal(count(sequence({},p=>p,{duration,step:50})),1,String(duration));
  for(const options of [{mirror:true},{swap:true},{aspect:16/9},{aspect:1},{roll:20},{roll:-20,mirror:true},
    {leftProgress:0,rightProgress:0}])assert.equal(count(sequence(options)),1,JSON.stringify(options));
  assert.equal(count(sequence({},(pair,t)=>t%200?pair.reverse():pair)),1);
});
test('one hand, static open hands and static close hands cannot trigger',()=>{
  for(const transform of [pair=>pair.slice(0,1),()=>hands(0),()=>hands(1)])assert.equal(count(sequence({},transform)),0);
});
test('one hand moving toward a stationary hand does not trigger',()=>{
  const stationary=hands(0)[1];assert.equal(count(sequence({},pair=>[pair[0],stationary])),0);
});
test('parallel hand motion and rotation without convergence cannot trigger',()=>{
  assert.equal(count(sequence({converge:false})),0);
  assert.equal(count(sequence({},(pair,t)=>hands(0).map(hand=>hand.map(p=>({...p,y:p.y-.05*Math.min(1,t/1400)}))))),0);
});
test('a teleport to contact without an observed approach is rejected',()=>{
  assert.equal(count(sequence({},(pair,t)=>hands(t<=600?0:1))),0);
});
test('closing hands very slowly and reversing before the clap reset',()=>{
  assert.equal(count(sequence({},p=>p,{duration:5000})),0);
  const d=new HandSweep(),r=[],path=[...Array(7).fill(0),.15,.3,.45,.1,0,0,1,1];
  path.forEach((p,i)=>r.push(d.update(hands(p),i*100,{width:640,height:480})));
  assert.equal(count(r),0);
});
test('brief tracking loss is tolerated but long loss requires a fresh apart hold',()=>{
  assert.equal(count(sequence({},(pair,t)=>t===900?[]:pair)),1);
  assert.equal(count(sequence({},(pair,t)=>t>=800&&t<=1300?[]:pair)),0);
});
test('fists cannot arm; two extended fingers are sufficient',()=>{
  const fold=(pair,ids)=>{for(const hand of pair)for(const i of ids)hand[i]={...hand[0]};return pair;};
  assert.equal(count(sequence({},pair=>fold(pair,[8,12,16,20]))),0);
  assert.equal(count(sequence({},pair=>fold(pair,[16,20]))),1);
});
test('invalid, duplicate, cropped and sparse hands fail safely',()=>{
  for(const transform of [()=>Array(2),pair=>[pair[0],null],pair=>[pair[0],pair[0]],
    pair=>{pair[0][0].x=-.1;return pair;},pair=>{pair[0][9].y=NaN;return pair;}])assert.equal(count(sequence({},transform)),0);
});
test('reset requires a fresh starting hold; malformed time and dimensions cannot trigger',()=>{
  const d=new HandSweep();for(let t=0;t<=500;t+=100)d.update(hands(0),t,{width:640,height:480});d.reset();
  for(let t=600;t<=1600;t+=100)assert.equal(d.update(hands(1),t,{width:640,height:480}).triggered,false);
  assert.equal(d.update(hands(0),1700,{width:0,height:480}).triggered,false);
  assert.equal(d.update(hands(0),NaN).phase,'idle');
});
