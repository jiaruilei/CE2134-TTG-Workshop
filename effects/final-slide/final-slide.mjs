import {WaterTank} from './water-tank.mjs';
import {SharedHandInput} from './shared-hand-input.mjs?v=1d5817721d90';

const $ = id => document.getElementById(id);
const deck = window.workshopDeck;
const deckElement = document.querySelector('.reveal');
const deckControls = document.querySelector('.deck-controls');
// Keep the GPU available to the live lab until the wave is actually requested.
let tank = null;
const duration = 9600;
let finalSlide = false, phase = 'idle', paused = false;
let elapsed = 0, lastTime = 0, renderTime = 0, raf = 0, lastPercent = -1;
deck.configure({keyboardCondition: event => phase !== 'running' &&
  !(event.key === ' ' && event.target.closest?.('#proceed'))});

function cameraStatus(text, code = 'ready'){
  $('camera-status').textContent = text;
  $('camera-state').dataset.state = code;
  $('camera-state').setAttribute('aria-label', text);
  $('camera-state').title = text;
}
const camera = new SharedHandInput({
  frame: document.querySelector('#slide-12 .summary-lab iframe'), onStatus: cameraStatus,
  onProgress(value){
    const progress = Math.max(0, Math.min(100, Math.round(Number(value)*100)));
    $('gesture-progress').style.width = progress+'%';
  },
  onTrigger(){ begin('gesture'); }
});

function setPhase(next){
  phase = next;
  document.body.dataset.wavePhase = next;
  const running = next === 'running';
  $('wave-controls').hidden = !running;
  $('fill-indicator').hidden = !running;
  deckElement.inert = running;
  deckControls.inert = running;
  $('proceed').disabled = running;
}
function startCamera(){
  if(!finalSlide || document.hidden) return;
  camera.setEnabled(phase === 'ready');
  // The embedded lab owns the only camera and sends its hand landmarks here.
  camera.start().catch(error => cameraStatus(error?.message || 'Camera unavailable. Proceed still works.', 'error'));
}
function hideWater(){
  paused = false;
  $('water').hidden = true;
  $('water').style.opacity = '0';
  delete document.body.dataset.waveSubphase;
}
function begin(source = 'button'){
  if(!finalSlide || phase !== 'ready') return;
  camera.setEnabled(false);
  paused = false; elapsed = 0; lastPercent = -1;
  $('pause').textContent = 'Pause water';
  $('fill-label').textContent = 'Water entering';
  $('water').hidden = false;
  $('water').style.opacity = '1';
  if(!tank) tank = new WaterTank($('water'));
  tank.resize();
  setPhase('running');
  $('pause').focus({preventScroll:true});
  $('wave-status').textContent = source === 'gesture' ? 'Hand clap gesture detected. The wave is starting.' : 'The wave is starting.';
}
function finish({focus = true} = {}){
  hideWater();
  setPhase(finalSlide ? 'ready' : 'idle');
  if(finalSlide){
    camera.setEnabled(true);
    $('wave-status').textContent = 'Wave complete. Proceed or repeat the hand clap gesture to play again.';
    if(focus) $('proceed').focus({preventScroll:true});
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
function togglePause(){
  if(phase !== 'running') return;
  paused = !paused;
  $('pause').textContent = paused ? 'Resume water' : 'Pause water';
  $('fill-label').textContent = paused ? 'Water paused' : 'Water entering';
}
function frame(now){
  const dt = lastTime ? Math.min(50,now-lastTime) : 0;
  lastTime = now;
  if(!document.hidden && !paused){
    renderTime += dt/1000;
    if(phase === 'running') elapsed += dt;
  }
  if(phase === 'running'){
    const fraction = Math.min(1,elapsed/duration);
    const filling = Math.min(1,fraction/.76);
    const progress = filling*filling*(3-2*filling);
    const entry = Math.min(1,elapsed/900), exit = Math.min(1,(duration-elapsed)/1000);
    const reveal = Math.max(0,entry*entry*(3-2*entry)*exit*exit*(3-2*exit));
    $('water').style.opacity = String(fraction>.90 ? Math.max(0,1-(fraction-.90)/.10) : 1);
    tank.render({time:renderTime,progress,intensity:1,reveal});
    document.body.dataset.waveSubphase = fraction>.79 && fraction<.94 ? 'immersed' : 'filling';
    const percent = Math.round(progress*100);
    if(percent !== lastPercent){ $('fill-value').textContent = percent+'%'; lastPercent = percent; }
    if(!paused) $('fill-label').textContent = fraction>.90 ? 'Returning to slide' : progress>=1 ? 'Fully immersed' : 'Water entering';
    if(fraction===1) finish();
  }
  raf = requestAnimationFrame(frame);
}
$('proceed').addEventListener('click',event=>{event.stopPropagation();begin();});
$('pause').addEventListener('click',togglePause);
$('skip').addEventListener('click',()=>finish());
document.addEventListener('keydown',event=>{
  if(phase !== 'running') return;
  if(event.key==='Escape'){
    event.preventDefault(); event.stopImmediatePropagation(); finish();
  }else if(event.key===' ' && !event.target.closest('button')){
    event.preventDefault(); event.stopImmediatePropagation(); togglePause();
  }else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)){
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
