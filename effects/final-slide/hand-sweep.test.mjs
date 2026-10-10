import test from 'node:test';
import assert from 'node:assert/strict';
import {HandSweep} from './hand-sweep.mjs';
import {hands} from './hand-fixtures.mjs';
const count = results => results.filter(result => result.triggered).length;
function sequence(options = {}, transform = points => points) {
  const detector = new HandSweep(), results = [];
  const update = (p, t) => results.push(detector.update(transform(hands(p, options), t), t, {width: options.aspect || 4/3, height: 1}));
  for (let t = 0; t <= 700; t += 100) update(0, t);
  for (let t = 800; t <= 2000; t += 100) update((t - 700) / 1300, t);
  for (let t = 2100; t <= 2700; t += 100) update(1, t);
  return results;
}
test('two horizontal hands turning upright and closer trigger once without body landmarks', () => {
  const results = sequence();
  assert.equal(count(results), 1); assert.equal(results.at(-1).phase, 'complete');
});
test('mirrors, model order changes, aspect ratios and moderate camera roll work', () => {
  for (const options of [{mirror:true},{swap:true},{aspect:16/9},{aspect:1},{roll:15},{roll:-15,mirror:true}]) {
    assert.equal(count(sequence(options)), 1, JSON.stringify(options));
  }
  assert.equal(count(sequence({}, (pair,t) => t%200 ? pair.reverse() : pair)), 1);
});
test('small jitter and modest differences in hand timing are tolerated', () => {
  const d = new HandSweep(), results=[];
  for(let i=0;i<32;i++) {
    const progress=i<8?0:Math.min(1,(i-8)/13);
    results.push(d.update(hands(progress,{leftProgress:progress+(i%2?.02:-.02),rightProgress:Math.max(0,progress-.08)}),i*100,{width:640,height:480}));
  }
  assert.equal(count(results),1);
});
test('static upright hands, a single hand, and horizontal hand convergence do not trigger', () => {
  for(const get of [()=>hands(1),()=>hands(0).slice(0,1),p=>hands(p,{leftProgress:0,rightProgress:0})]) {
    const d=new HandSweep(),results=[];
    for(let i=0;i<40;i++)results.push(d.update(get(Math.min(1,i/20)),i*100,{width:640,height:480}));
    assert.equal(count(results),0);
  }
});
test('rotation without convergence and one-hand rotation cannot trigger', () => {
  assert.equal(count(sequence({converge:false})),0);
  const d=new HandSweep(),results=[];
  for(let i=0;i<40;i++) {
    const p=i<8?0:Math.min(1,(i-8)/13);
    results.push(d.update(hands(p,{leftProgress:0,rightProgress:p}),i*100,{width:640,height:480}));
  }
  assert.equal(count(results),0);
});
test('teleporting directly from horizontal to upright is rejected', () => {
  const d=new HandSweep(),results=[];
  for(let i=0;i<30;i++)results.push(d.update(hands(i<8?0:1),i*100,{width:640,height:480}));
  assert.equal(count(results),0);
});
test('brief missing hands tolerate tracking gaps, but long gaps require a new start', () => {
  assert.equal(count(sequence({},(pair,t)=>t===1200?[]:pair)),1);
  assert.equal(count(sequence({},(pair,t)=>t>=1000&&t<=1600?[]:pair)),0);
});
test('cropped wrists, invalid coordinates, missing keypoints and duplicate hands never trigger', () => {
  for(const transform of [pair=>{pair[0][0].x=-.1;return pair;},pair=>{pair[1][9].y=NaN;return pair;},
    pair=>[pair[0].slice(0,5),pair[1]],pair=>[pair[0],pair[0]]]) assert.equal(count(sequence({},transform)),0);
});
test('large reversals and slow movements reset', () => {
  const d=new HandSweep(),results=[];
  const path=[...Array(8).fill(0),.2,.4,.6,.1,...Array(10).fill(1)];
  path.forEach((p,i)=>results.push(d.update(hands(p),i*100,{width:640,height:480})));
  assert.equal(count(results),0);
  const slow=new HandSweep(),r=[];
  for(let i=0;i<140;i++)r.push(slow.update(hands(i<8?0:Math.min(1,(i-8)/100)),i*100,{width:640,height:480}));
  assert.equal(count(r),0);
});
test('closed fists do not trigger, while two extended fingers per hand are sufficient', () => {
  const fold = (pair, ids) => {
    for (const hand of pair) for (const id of ids) hand[id] = {...hand[0]};
    return pair;
  };
  assert.equal(count(sequence({}, pair => fold(pair,[8,12,16,20]))),0);
  assert.equal(count(sequence({}, pair => fold(pair,[16,20]))),1);
});
test('missing hand array entries are rejected without throwing', () => {
  const d = new HandSweep();
  for(const value of [Array(2),[hands()[0],null],[undefined,hands()[1]]]) {
    assert.equal(d.update(value,100,{width:640,height:480}).triggered,false);
  }
});
test('reset cannot reuse an upright pose and malformed dimensions reset safely', () => {
  const d=new HandSweep();
  for(let t=0;t<=700;t+=100)d.update(hands(0),t,{width:640,height:480});
  d.reset();
  for(let t=800;t<=1800;t+=100)assert.equal(d.update(hands(1),t,{width:640,height:480}).triggered,false);
  assert.equal(d.update(hands(0),1900,{width:0,height:480}).triggered,false);
  assert.equal(d.update(hands(0),NaN).phase,'idle');
});
