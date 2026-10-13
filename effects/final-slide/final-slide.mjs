import {WaterTank} from './water-tank.mjs?v=67691f627ced';
import {SharedHandInput} from './shared-hand-input.mjs?v=a476479eb491';

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
let transition = 0;
deck.configure({keyboardCondition: () => !['preparing', 'running'].includes(phase)});

function cameraStatus(text){
  $('camera-status').textContent = text;
}
const camera = new SharedHandInput({
  frame: document.querySelector('#slide-12 .summary-lab iframe'), onStatus: cameraStatus,
  onTrigger(){ begin('gesture'); },
  onRenderStatus(status){
    if(status.state === 'ready' && !status.paused && phase === 'recovering' && finalSlide && !document.hidden){
      setPhase('ready'); camera.setEnabled(true);
      if($('notice')?.dataset.tankRecovery) $('notice').hidden = true;
      $('wave-status').textContent = 'Wave complete. Separate your hands and clap again to replay.';
    }else if(status.state === 'error' && finalSlide){
      showRecoveryMessage(status.message);
    }
  }
});

function showRecoveryMessage(message){
  cameraStatus(message);
  const notice = $('notice');
  if(notice){notice.textContent = message; notice.dataset.tankRecovery = 'true'; notice.hidden = false;}
}

function setPhase(next){
  phase = next;
  document.body.dataset.wavePhase = next;
  const running = next === 'running' || next === 'preparing';
  deckElement.inert = running;
  deckControls.inert = running;
}
async function startCamera(){
  if(!finalSlide || document.hidden) return;
  camera.setEnabled(phase === 'ready');
  // The embedded lab owns the only camera and sends its hand landmarks here.
  await camera.start();
  if(phase === 'recovering') await camera.setLabPaused(false);
}
function hideWater(){
  $('water').hidden = true;
  $('water').style.opacity = '0';
  delete document.body.dataset.waveSubphase;
  $('water-caption').style.removeProperty('--merge-delay');
}
function releaseWater(){
  hideWater();
  if(!tank) return;
  try { tank.dispose(); }
  catch(error){console.warn('Ending resource cleanup failed; continuing tank recovery.',error);}
  finally {
    tank = null;
    // A deliberately released WebGL canvas cannot be reused. Replays get a
    // fresh drawing surface while preserving the overlay's DOM attributes.
    const old = $('water'), fresh = old.cloneNode(false);
    fresh.width = fresh.height = 1;
    old.replaceWith(fresh);
  }
}
async function begin(source = 'gesture', resume = false){
  if(!finalSlide || document.hidden || phase !== (resume ? 'suspended' : 'ready')) return;
  const current = ++transition;
  camera.setEnabled(false);
  setPhase('preparing');
  if(!resume){elapsed = 0; captionAnnounced = false;}
  try {
    await camera.start();
    if(current !== transition) return;
    const paused = await camera.setLabPaused(true);
    if(current !== transition || !finalSlide || document.hidden) return;
    if(!paused) throw new Error('The tank could not pause for the ending. Use Reload in the tank toolbar, then try again.');
    $('water').hidden = false;
    $('water').style.opacity = '1';
    tank = new WaterTank($('water'));
    tank.resize();
    lastTime = 0;
    setPhase('running');
    $('wave-status').textContent = source === 'gesture' ? 'Hand clap gesture detected. The wave is starting.' : 'The wave is starting.';
    // Bring keyboard focus out of the lab iframe so Escape remains available.
    $('wave-status').focus({preventScroll:true});
  }catch(error){
    if(current !== transition) return;
    showRecoveryMessage(error?.message || 'Unable to start the ending. Reload the tank to reconnect.');
    void finish();
  }
}
async function finish({focus = true} = {}){
  const current = ++transition;
  camera.setEnabled(false);
  releaseWater();
  setPhase(finalSlide ? 'recovering' : 'idle');
  const resumed = await camera.setLabPaused(false);
  if(current !== transition || !finalSlide || document.hidden) return;
  if(resumed){
    setPhase('ready'); camera.setEnabled(true);
    $('wave-status').textContent = 'Wave complete. Separate your hands and clap again to replay.';
    if(focus) $('wave-status').focus({preventScroll:true});
  }
}
function syncSlide(){
  const next = deck.getCurrentSlide()?.id === 'slide-12' && !deck.isOverview() && !deck.isPaused();
  if(next === finalSlide) return;
  finalSlide = next;
  if(finalSlide){
    releaseWater(); setPhase('ready');
    $('wave-status').textContent = '';
    void startCamera().catch(error => cameraStatus(error.message));
  }else{
    ++transition;
    releaseWater();
    void camera.setLabPaused(false);
    camera.setEnabled(false); camera.stop();
    setPhase('idle');
    $('wave-status').textContent = '';
  }
}
function frame(now){
  // Schedule first: a recoverable drawing failure must not kill this loop.
  raf = requestAnimationFrame(frame);
  const dt = lastTime ? Math.min(50,now-lastTime) : 0;
  lastTime = now;
  if(!document.hidden){
    renderTime += dt/1000;
    if(phase === 'running') elapsed += dt;
  }
  if(phase === 'running' && !document.hidden){
    // Hold the water fully immersed while the words merge and remain readable.
    const timelineElapsed = elapsed <= endingHoldAt ? elapsed : Math.max(endingHoldAt,elapsed-endingHold);
    const fraction = Math.min(1,timelineElapsed/duration);
    const filling = Math.min(1,fraction/.76);
    const progress = filling*filling*(3-2*filling);
    const entry = Math.min(1,timelineElapsed/900), exit = Math.min(1,(duration-timelineElapsed)/1000);
    const reveal = Math.max(0,entry*entry*(3-2*entry)*exit*exit*(3-2*exit));
    $('water').style.opacity = String(fraction>.90 ? Math.max(0,1-(fraction-.90)/.10) : 1);
    try {tank.render({time:renderTime,progress,intensity:1,reveal});}
    catch(error){
      console.warn('Ending renderer failed; returning to the tank.',error);
      void finish(); return;
    }
    // Sample paused CSS keyframes from the wave clock, including tab suspension.
    $('water-caption').style.setProperty('--merge-delay', `${-Math.max(0,elapsed-captionStart)}ms`);
    document.body.dataset.waveSubphase = fraction>.79 && fraction<.94 ? 'immersed' : 'filling';
    if(!captionAnnounced && elapsed>=captionStart){
      captionAnnounced = true;
      $('wave-status').textContent = 'Physical plus Digital becomes Phygital. With support from CEE, CDE, CTLT and NUS.';
    }
    if(fraction===1) void finish();
  }
}
document.addEventListener('keydown',event=>{
  if(!['preparing', 'running', 'recovering'].includes(phase)) return;
  if(event.key==='Escape'){
    event.preventDefault(); event.stopImmediatePropagation(); void finish();
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
  if(document.hidden){
    ++transition;
    if(['running','preparing'].includes(phase)){releaseWater();setPhase('suspended');}
    camera.setEnabled(false);camera.stop();
  }else if(phase === 'suspended') void begin('signal',true);
  else void startCamera().catch(error => cameraStatus(error.message));
});
window.addEventListener('pagehide',event=>{
  ++transition;
  if(['running','preparing'].includes(phase)) setPhase('suspended');
  releaseWater();
  camera.stop(); cancelAnimationFrame(raf);
  if(!event.persisted) camera.dispose();
});
window.addEventListener('pageshow',event=>{
  if(event.persisted){
    lastTime=0;raf=requestAnimationFrame(frame);syncSlide();
    if(phase === 'suspended') void begin('signal',true);
    else void startCamera().catch(error => cameraStatus(error.message));
  }
});
raf=requestAnimationFrame(frame);
