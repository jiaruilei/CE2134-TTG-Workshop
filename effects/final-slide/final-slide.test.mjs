import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the production controller with controlled browser/GPU boundaries.
// Assertions cover observable lifecycle ordering rather than copied timing logic.
const source = readFileSync(new URL('./final-slide.mjs', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type, fields = {}) {
      const event = {type, preventDefault() {}, stopImmediatePropagation() {}, ...fields};
      for (const fn of listeners.get(type) || []) fn(event);
    },
  };
}

function harness() {
  const log = [], nodes = new Map(), frames = new Map(), tanks = [];
  let frameId = 0, now = 100, camera;
  const faults = {construct: false, resize: false, render: false, dispose: false};
  function node(id) {
    const value = {
      id, hidden: id === 'water' || id === 'notice', inert: false, textContent: '', dataset: {},
      style: {setProperty(name, text) {this[name] = text;}, removeProperty(name) {delete this[name];}},
      cloneNode() {const copy = node(id); copy.hidden = this.hidden; Object.assign(copy.style, this.style); return copy;},
      replaceWith(fresh) {nodes.set(id, fresh); log.push('canvas:replace');},
      focus() {document.activeElement = this;},
    };
    return value;
  }
  for (const id of ['water', 'water-caption', 'wave-status', 'camera-status', 'notice', 'reveal', 'controls', 'lab']) nodes.set(id, node(id));
  const document = {...events(), hidden: false, body: {dataset: {}}, activeElement: null,
    getElementById: id => nodes.get(id),
    querySelector: selector => nodes.get(selector === '.reveal' ? 'reveal' : selector === '.deck-controls' ? 'controls' : 'lab'),
  };
  const deckEvents = events();
  const deck = {slide: 'slide-12', overview: false, paused: false,
    configure(options) {this.options = options;},
    on: deckEvents.addEventListener,
    getCurrentSlide() {return {id: this.slide};},
    isOverview() {return this.overview;}, isPaused() {return this.paused;}, isReady() {return true;},
    emit: deckEvents.emit,
  };
  const window = {...events(), workshopDeck: deck};
  class SharedHandInput {
    constructor(options) {camera = this; this.options = options; this.enabled = false; this.pending = [];}
    async start() {log.push('camera:start'); return true;}
    setEnabled(value) {this.enabled = value; log.push(`gesture:${value}`);}
    setLabPaused(paused) {
      log.push(`lab:${paused ? 'pause' : 'resume'}`);
      return new Promise(resolve => this.pending.push({paused, resolve, settled: false}));
    }
    ack(paused, success = true) {
      const pending = this.pending.find(item => !item.settled && item.paused === paused);
      assert.ok(pending, `Expected pending ${paused ? 'pause' : 'resume'} request`);
      pending.settled = true; pending.resolve(success);
    }
    stop() {log.push('camera:stop');}
    dispose() {log.push('camera:dispose');}
  }
  class WaterTank {
    constructor(canvas) {
      log.push('tank:create');
      if (faults.construct) throw new Error('GPU allocation failed');
      this.canvas = canvas; this.renders = []; this.disposeCount = 0; tanks.push(this);
    }
    resize() {if (faults.resize) throw new Error('GPU resize failed');}
    render(frame) {
      if (faults.render) throw new Error('GPU drawing failed');
      this.renders.push(frame);
    }
    dispose() {
      this.disposeCount++; log.push('tank:dispose');
      if (faults.dispose) throw new Error('GPU cleanup failed');
    }
  }
  vm.runInNewContext(source, {window, document, location: {origin: 'https://presentation.test'},
    SharedHandInput, WaterTank, console: {warn: (...args) => log.push(['warning', ...args])},
    requestAnimationFrame(fn) {frames.set(++frameId, fn); return frameId;},
    cancelAnimationFrame(id) {frames.delete(id);},
  }, {filename: 'final-slide.mjs'});
  const h = {
    log, nodes, document, window, deck, camera, tanks, faults, frames,
    get phase() {return document.body.dataset.wavePhase;},
    tick(delta = 50) {
      now += delta;
      const due = [...frames.entries()]; frames.clear();
      for (const [, fn] of due) fn(now);
    },
    async trigger() {window.emit('tank:proceed'); await flush();},
    async running() {await h.trigger(); camera.ack(true); await flush(); assert.equal(h.phase, 'running');},
    async resume() {camera.ack(false); await flush();},
    escape() {document.emit('keydown', {key: 'Escape'});},
    visibility(hidden) {document.hidden = hidden; document.emit('visibilitychange');},
  };
  return h;
}

test('waits for lab pause before GPU allocation and ignores duplicate starts', async () => {
  const h = harness(); await flush(); await h.trigger();
  assert.equal(h.phase, 'preparing'); assert.equal(h.tanks.length, 0);
  assert.equal(h.nodes.get('water').hidden, true); assert.equal(h.camera.enabled, false);
  await h.trigger(); assert.equal(h.log.filter(x => x === 'lab:pause').length, 1);
  h.camera.ack(true); await flush();
  assert.equal(h.phase, 'running'); assert.equal(h.tanks.length, 1);
  assert.equal(h.document.activeElement.id, 'wave-status');
  assert.ok(h.log.indexOf('lab:pause') < h.log.indexOf('tank:create'));
});

test('automatic completion disposes GPU before lab resume and waits before rearming', async () => {
  const h = harness(); await h.running(); const canvas = h.nodes.get('water');
  for (let i = 0; i < 325; i++) h.tick();
  assert.equal(h.phase, 'recovering'); assert.equal(h.tanks[0].disposeCount, 1);
  assert.notEqual(h.nodes.get('water'), canvas); assert.equal(h.nodes.get('water').hidden, true);
  assert.ok(h.log.indexOf('tank:dispose') < h.log.indexOf('lab:resume'));
  assert.equal(h.camera.enabled, false); assert.equal(h.frames.size, 1);
  await h.resume(); assert.equal(h.phase, 'ready'); assert.equal(h.camera.enabled, true);
  await h.running(); assert.equal(h.tanks.length, 2);
  assert.notEqual(h.tanks[1].canvas, h.tanks[0].canvas);
});

test('Escape during playback cleans up and restores interaction after acknowledgement', async () => {
  const h = harness(); await h.running(); h.escape(); await flush();
  assert.equal(h.phase, 'recovering'); assert.equal(h.tanks[0].disposeCount, 1);
  assert.equal(h.nodes.get('reveal').inert, false); assert.equal(h.nodes.get('controls').inert, false);
  await h.resume(); assert.equal(h.phase, 'ready');
});

test('Escape during preparation prevents a late pause acknowledgement from starting a wave', async () => {
  const h = harness(); await h.trigger(); h.escape(); await flush();
  h.camera.ack(true); await flush(); assert.equal(h.tanks.length, 0);
  await h.resume(); assert.equal(h.phase, 'ready');
});

test('slide exit, overview and blackout release GPU and permit fresh entry', async () => {
  for (const kind of ['slide', 'overview', 'blackout']) {
    const h = harness(); await h.running();
    if (kind === 'slide') {h.deck.slide = 'slide-11'; h.deck.emit('slidechanged');}
    if (kind === 'overview') {h.deck.overview = true; h.deck.emit('overviewshown');}
    if (kind === 'blackout') {h.deck.paused = true; h.deck.emit('paused');}
    assert.equal(h.phase, 'idle', kind); assert.equal(h.tanks[0].disposeCount, 1, kind);
    assert.ok(h.log.includes('camera:stop'), kind); assert.equal(h.camera.enabled, false, kind);
    h.camera.ack(false); await flush(); assert.equal(h.phase, 'idle', kind);
    h.deck.slide = 'slide-12'; h.deck.overview = false; h.deck.paused = false; h.deck.emit('slidechanged');
    await flush(); assert.equal(h.phase, 'ready', kind);
    await h.running(); assert.equal(h.tanks.length, 2, kind);
  }
});

test('slide exit invalidates preparation and old pause cannot allocate after reentry', async () => {
  const h = harness(); await h.trigger();
  h.deck.slide = 'slide-11'; h.deck.emit('slidechanged');
  h.deck.slide = 'slide-12'; h.deck.emit('slidechanged'); await flush();
  h.camera.ack(true); await flush();
  assert.equal(h.tanks.length, 0); assert.equal(h.phase, 'ready');
});

test('pause rejection and renderer initialization failures return to the lab safely', async () => {
  for (const fault of ['pause', 'construct', 'resize']) {
    const h = harness(); if (fault !== 'pause') h.faults[fault] = true;
    await h.trigger(); h.camera.ack(true, fault !== 'pause'); await flush();
    assert.equal(h.phase, 'recovering', fault); assert.equal(h.nodes.get('water').hidden, true, fault);
    assert.equal(h.nodes.get('notice').hidden, false, fault);
    if (fault === 'resize') assert.equal(h.tanks[0].disposeCount, 1);
    await h.resume(); assert.equal(h.phase, 'ready', fault);
  }
});

test('drawing failure preserves RAF loop and resumes lab after disposing the ending', async () => {
  const h = harness(); await h.running(); h.faults.render = true; h.tick(); await flush();
  assert.equal(h.phase, 'recovering'); assert.equal(h.tanks[0].disposeCount, 1);
  assert.equal(h.frames.size, 1); await h.resume(); assert.equal(h.phase, 'ready');
});

test('hiding releases GPU and resumes the same wave timeline on a new canvas', async () => {
  const h = harness(); await h.running();
  for (let i = 0; i < 80; i++) h.tick();
  const progress = h.tanks[0].renders.at(-1).progress;
  h.visibility(true); assert.equal(h.phase, 'suspended'); assert.equal(h.tanks[0].disposeCount, 1);
  for (let i = 0; i < 20; i++) h.tick();
  assert.equal(h.tanks[0].renders.length, 80);
  h.visibility(false); await flush(); assert.equal(h.phase, 'preparing');
  h.camera.ack(true); await flush(); h.tick();
  assert.equal(h.phase, 'running'); assert.equal(h.tanks.length, 2);
  assert.equal(h.tanks[1].renders[0].progress, progress);
  assert.equal(h.frames.size, 1);
});

test('hiding during preparation rejects old acknowledgement and requires a fresh pause', async () => {
  const h = harness(); await h.trigger(); h.visibility(true);
  h.camera.ack(true); await flush(); assert.equal(h.tanks.length, 0);
  h.visibility(false); await flush(); assert.equal(h.phase, 'preparing');
  h.camera.ack(true); await flush(); assert.equal(h.tanks.length, 1);
});

test('back-forward cache round trips release GPU without duplicating RAF loops', async () => {
  const h = harness(); await h.running();
  for (let i = 0; i < 3; i++) {
    h.window.emit('pagehide', {persisted: true});
    assert.equal(h.frames.size, 0); assert.equal(h.phase, 'suspended');
    h.window.emit('pageshow', {persisted: true}); await flush();
    assert.equal(h.frames.size, 1); h.camera.ack(true); await flush(); h.tick();
    assert.equal(h.phase, 'running'); assert.equal(h.frames.size, 1);
  }
  assert.equal(h.tanks.length, 4); assert.equal(h.log.includes('camera:dispose'), false);
  h.window.emit('pagehide', {persisted: false});
  assert.equal(h.frames.size, 0); assert.ok(h.log.includes('camera:dispose'));
});

test('late resume acknowledgement cannot rearm after leaving the final slide', async () => {
  const h = harness(); await h.running(); h.escape(); await flush();
  h.deck.slide = 'slide-11'; h.deck.emit('slidechanged');
  h.camera.ack(false); await flush();
  assert.equal(h.phase, 'idle'); assert.equal(h.camera.enabled, false);
});

test('GPU disposal failure cannot strand lab recovery or interrupt exit cleanup', async () => {
  for (const exit of ['escape', 'hidden', 'slide']) {
    const h = harness(); await h.running(); h.faults.dispose = true;
    const oldCanvas = h.nodes.get('water');
    if (exit === 'escape') h.escape();
    if (exit === 'hidden') h.visibility(true);
    if (exit === 'slide') {h.deck.slide = 'slide-11'; h.deck.emit('slidechanged');}
    await flush();
    assert.equal(h.tanks[0].disposeCount, 1, exit);
    assert.notEqual(h.nodes.get('water'), oldCanvas, exit);
    assert.equal(h.nodes.get('water').hidden, true, exit);
    assert.equal(h.nodes.get('reveal').inert, false, exit);
    if (exit === 'escape') {
      assert.equal(h.phase, 'recovering'); await h.resume(); assert.equal(h.phase, 'ready');
    } else {
      assert.ok(h.log.includes('camera:stop'), exit);
      assert.equal(h.phase, exit === 'hidden' ? 'suspended' : 'idle');
    }
    assert.equal(h.frames.size, 1, exit);
  }
});

test('failed lab resume stays disarmed until an explicit ready render status', async () => {
  const h = harness(); await h.running(); h.escape(); await flush();
  h.camera.ack(false, false); await flush();
  assert.equal(h.phase, 'recovering'); assert.equal(h.camera.enabled, false);
  h.camera.options.onRenderStatus({state: 'error', paused: false, message: 'Reload the tank to recover.'});
  assert.equal(h.nodes.get('notice').hidden, false);
  h.camera.options.onRenderStatus({state: 'ready', paused: true});
  assert.equal(h.phase, 'recovering'); assert.equal(h.camera.enabled, false);
  h.camera.options.onRenderStatus({state: 'ready', paused: false});
  assert.equal(h.phase, 'ready'); assert.equal(h.camera.enabled, true);
  assert.equal(h.nodes.get('notice').hidden, true);
});
