import {WaterTank} from './water-tank.mjs';
import {SharedHandInput} from './shared-hand-input.mjs?v=1d5817721d90';

const $ = id => document.getElementById(id);
const deck = window.workshopDeck;
const deckElement = document.querySelector('.reveal');
const deckControls = document.querySelector('.deck-controls');
// Keep the GPU available to the live lab until the wave is actually requested.
let tank = null;
const duration = 9600;
// Allow the 3.6-second text merge, then hold PHYGITAL for over four seconds.
const endingHold = 6000, endingHoldAt = duration * .84;
const captionStart = duration * .79;
let finalSlide = false, phase = 'idle';
let captionAnnounced = false;
let elapsed = 0, lastTime = 0, renderTime = 0, raf = 0;
deck.configure({keyboardCondition: () => phase !== 'running'});

function cameraStatus(text){
  $('camera-status').textContent = text;
}
const camera = new SharedHandInput({
  frame: document.querySelector('#slide-12 .summary-lab iframe'), onStatus: cameraStatus,
  onTrigger(){ begin('gesture'); }
});

function setPhase(next){
  phase = next;
  document.body.dataset.wavePhase = next;
  const running = next === 'running';
  deckElement.inert = running;
  deckControls.inert = running;
}
function startCamera(){
  if(!finalSlide || document.hidden) return;
  camera.setEnabled(phase === 'ready');
  // The embedded lab owns the only camera and sends its hand landmarks here.
  camera.start().catch(error => cameraStatus(error?.message || 'Camera unavailable. Allow camera access to use the clap gesture.'));
}
function hideWater(){
  $('water').hidden = true;
  $('water').style.opacity = '0';
  delete document.body.dataset.waveSubphase;
  $('water-caption').style.removeProperty('--merge-delay');
}
function begin(source = 'gesture'){
  if(!finalSlide || phase !== 'ready') return;
  camera.setEnabled(false);
  elapsed = 0;
  captionAnnounced = false;
  $('water').hidden = false;
  $('water').style.opacity = '1';
  if(!tank) tank = new WaterTank($('water'));
  tank.resize();
  setPhase('running');
  $('wave-status').textContent = source === 'gesture' ? 'Hand clap gesture detected. The wave is starting.' : 'The wave is starting.';
  // Bring keyboard focus out of the lab iframe so Escape remains available.
  $('wave-status').focus({preventScroll:true});
}
function finish({focus = true} = {}){
  hideWater();
  setPhase(finalSlide ? 'ready' : 'idle');
  if(finalSlide){
    camera.setEnabled(true);
    $('wave-status').textContent = 'Wave complete. Separate your hands and clap again to replay.';
    if(focus) $('wave-status').focus({preventScroll:true});
  }
}
function syncSlide(){
  const next = deck.getCurrentSlide()?.id === 'slide-12' && !deck.isOverview() && !deck.isPaused();
  if(next === finalSlide) return;
  finalSlide = next;
  if(finalSlide){
    hideWater(); setPhase('ready');
    $('wave-status').textContent = '';
    startCamera();
  }else{
    camera.setEnabled(false); camera.stop();
    hideWater(); setPhase('idle');
    $('wave-status').textContent = '';
  }
}
function frame(now){
  const dt = lastTime ? Math.min(50,now-lastTime) : 0;
  lastTime = now;
  if(!document.hidden){
    renderTime += dt/1000;
    if(phase === 'running') elapsed += dt;
  }
  if(phase === 'running'){
    // Hold the water fully immersed while the words merge and remain readable.
    const timelineElapsed = elapsed <= endingHoldAt ? elapsed : Math.max(endingHoldAt,elapsed-endingHold);
    const fraction = Math.min(1,timelineElapsed/duration);
    const filling = Math.min(1,fraction/.76);
    const progress = filling*filling*(3-2*filling);
    const entry = Math.min(1,timelineElapsed/900), exit = Math.min(1,(duration-timelineElapsed)/1000);
    const reveal = Math.max(0,entry*entry*(3-2*entry)*exit*exit*(3-2*exit));
    $('water').style.opacity = String(fraction>.90 ? Math.max(0,1-(fraction-.90)/.10) : 1);
    tank.render({time:renderTime,progress,intensity:1,reveal});
    // Sample paused CSS keyframes from the wave clock, including tab suspension.
    $('water-caption').style.setProperty('--merge-delay', `${-Math.max(0,elapsed-captionStart)}ms`);
    document.body.dataset.waveSubphase = fraction>.79 && fraction<.94 ? 'immersed' : 'filling';
    if(!captionAnnounced && elapsed>=captionStart){
      captionAnnounced = true;
      $('wave-status').textContent = 'Physical plus Digital becomes Phygital. With support from CEE, CDE, CTLT and NUS.';
    }
    if(fraction===1) finish();
  }
  raf = requestAnimationFrame(frame);
}
document.addEventListener('keydown',event=>{
  if(phase !== 'running') return;
  if(event.key==='Escape'){
    event.preventDefault(); event.stopImmediatePropagation(); finish();
  }else if([' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)){
    event.preventDefault(); event.stopImmediatePropagation();
  }
},true);
deck.on('ready',syncSlide);
deck.on('slidechanged',syncSlide);
deck.on('overviewshown',syncSlide);
deck.on('overviewhidden',syncSlide);
deck.on('paused',syncSlide);
deck.on('resumed',syncSlide);
if(deck.isReady()) syncSlide();
window.addEventListener('tank:proceed',()=>begin('signal'));
window.addEventListener('message',event=>{
  if(event.origin===location.origin && event.data?.type==='tank:proceed') begin('signal');
});
window.addEventListener('resize',()=>tank?.resize());
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){camera.setEnabled(false);camera.stop();}
  else startCamera();
});
window.addEventListener('pagehide',event=>{
  camera.stop(); cancelAnimationFrame(raf);
  if(!event.persisted){camera.dispose();tank?.dispose();}
});
window.addEventListener('pageshow',event=>{
  if(event.persisted){lastTime=0;raf=requestAnimationFrame(frame);syncSlide();startCamera();}
});
raf=requestAnimationFrame(frame);
