/** A deliberate clap detected from two hands; no body landmarks or audio. */
const HOLD_MS = 300, MAX_GAP_MS = 350;
const READY = 'Show two open hands apart, then clap them together.';
const clamp = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x*b.x + a.y*b.y;
const delta = (a, b) => ({x:a.x-b.x,y:a.y-b.y});

export class HandSweep {
  constructor() { this.reset(); }
  reset() {
    this.phase='idle'; this.progress=0;
    this.lastSampleAt=this.lastValidAt=null;
    this.holdElapsed=0; this.lastApart=false;
    this.baseline=this.previous=null;
    this.armedAt=this.sweepAt=null;
    this.closestRatio=1; this.movingFrames=0;
  }
  result(message=READY,triggered=false) { return {phase:this.phase,progress:this.progress,message,triggered}; }
  restart(message=READY) { this.reset(); return this.result(message); }
  update(landmarks,now,{width=1,height=1}={}) {
    if(this.phase==='complete') return this.result('Clap detected.');
    if(!Number.isFinite(now)) return this.restart();
    let previousAt=this.lastSampleAt;
    if(previousAt!==null && (now<=previousAt || now-previousAt>MAX_GAP_MS)) { this.reset();previousAt=null; }
    this.lastSampleAt=now;
    const measured=measureHands(landmarks,width,height);
    if(!measured) {
      this.holdElapsed=0;this.lastApart=false;
      if(this.lastValidAt!==null && now-this.lastValidAt>MAX_GAP_MS) this.reset();
      return this.result('Keep both hands visible. Separate them, then clap.');
    }
    const hands=matchHands(measured,this.previous);
    const dt=previousAt!==null && previousAt===this.lastValidAt ? now-previousAt : 0;
    this.lastValidAt=now;
    const gap=distance(hands[0].center,hands[1].center);
    const size=(hands[0].size+hands[1].size)/2;
    const apart=hands.every(hand=>hand.open) && gap>Math.max(.1,size*3) &&
      Math.abs(hands[0].center.y-hands[1].center.y)<gap*.55;
    if(this.phase==='idle') {
      const stable=!this.previous || hands.every((h,i)=>distance(h.center,this.previous[i].center)<gap*.10);
      this.holdElapsed=apart&&stable ? this.holdElapsed+(this.lastApart?dt:0):0;
      this.lastApart=apart&&stable;this.previous=hands;
      this.progress=.2*clamp(this.holdElapsed/HOLD_MS);
      if(this.holdElapsed<HOLD_MS) return this.result(apart?'Hold both open hands apart briefly…':READY);
      this.phase='armed';this.armedAt=now;
      this.baseline={hands,gap,axis:{x:(hands[1].center.x-hands[0].center.x)/gap,y:(hands[1].center.y-hands[0].center.y)/gap}};
      return this.result('Clap your hands together.');
    }
    const base=this.baseline,ratio=gap/base.gap;
    const inward=[dot(delta(hands[0].center,base.hands[0].center),base.axis)/base.gap,
      dot(delta(base.hands[1].center,hands[1].center),base.axis)/base.gap];
    if(ratio>1.35 || inward.some(value=>value<-.15) ||
       hands.some((h,i)=>h.size/base.hands[i].size<.5 || h.size/base.hands[i].size>1.8 ||
         distance(h.center,this.previous[i].center)>base.gap*Math.max(.30,(dt||70)/300))) {
      return this.restart('Separate your hands, then make one deliberate clap.');
    }
    const previousGap=distance(this.previous[0].center,this.previous[1].center);
    this.previous=hands;
    if(this.phase==='armed') {
      if(now-this.armedAt>4000) return this.restart();
      if(ratio>.90) return this.result('Clap your hands together.');
      // A direct jump to touching hands is not evidence of a clap trajectory.
      if(ratio<.58) return this.restart('Start with both hands apart, then clap.');
      this.phase='sweeping';this.sweepAt=now;this.closestRatio=ratio;
    }
    if(now-this.sweepAt>1600 || ratio-this.closestRatio>.20) return this.restart();
    this.closestRatio=Math.min(this.closestRatio,ratio);
    if(previousGap-gap>base.gap*.015) this.movingFrames++;
    this.progress=.2+.8*clamp((1-ratio)/.55);
    // Recognise the approach before contact can hide one hand from the camera.
    // Both hands must move inward; ordinary one-handed lab interaction cannot fire.
    if(ratio<=.48 && inward.every(value=>value>=.16) && this.movingFrames>=2 && now-this.sweepAt>=100) {
      this.phase='complete';this.progress=1;
      return this.result('Clap detected.',true);
    }
    return this.result('Bring both palms together to clap.');
  }
}
function matchHands(hands,previous) {
  if(!previous) return hands.sort((a,b)=>a.center.x-b.center.x);
  const direct=distance(hands[0].center,previous[0].center)+distance(hands[1].center,previous[1].center);
  const swapped=distance(hands[1].center,previous[0].center)+distance(hands[0].center,previous[1].center);
  return swapped<direct?[hands[1],hands[0]]:hands;
}
function measureHands(landmarks,width,height) {
  if(!Array.isArray(landmarks)||landmarks.length!==2||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) return null;
  const aspect=width/height;
  const hands=[landmarks[0],landmarks[1]].map(points=>{
    if(!Array.isArray(points)||points.length<21) return null;
    const core=[0,5,9,13,17].map(i=>points[i]);
    if(core.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<.005||p.x>.995||p.y<.005||p.y>.995)) return null;
    const palm=core.map(p=>({x:p.x*aspect,y:p.y}));
    const [wrist,,middle]=palm,size=distance(wrist,middle);
    if(size<.018||size>.45) return null;
    const center=palm.reduce((c,p)=>({x:c.x+p.x/5,y:c.y+p.y/5}),{x:0,y:0});
    const extended=[5,9,13,17].filter(i=>{
      const base=points[i],tip=points[i+3];
      if(!tip||!Number.isFinite(tip.x)||!Number.isFinite(tip.y)) return false;
      return distance(wrist,{x:tip.x*aspect,y:tip.y})>=distance(wrist,{x:base.x*aspect,y:base.y})*1.3;
    }).length;
    return {center,size,open:extended>=2};
  });
  if(hands.some(hand=>!hand)) return null;
  if(distance(hands[0].center,hands[1].center)<Math.min(hands[0].size,hands[1].size)*.35) return null;
  return hands;
}
