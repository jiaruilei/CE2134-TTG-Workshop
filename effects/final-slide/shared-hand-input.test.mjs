import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedHandInput} from './shared-hand-input.mjs';
import {hands} from './hand-fixtures.mjs';

const CHILD = 'https://ce2134-interactive-lab-tank.onrender.com';
const envelope = (session, type, fields = {}) => ({channel: 'ce2134-hand-tracking', version: 1, type, session, ...fields});

function harness() {
  const window = new EventTarget(), document = new EventTarget(), frame = new EventTarget();
  const messages = [], statuses = [], progress = [], timers = new Map();
  let now = 0, timerId = 0, uuid = 0, fired = 0, seq = 0;
  const child = {postMessage(data, targetOrigin) { messages.push({data, targetOrigin}); }};
  Object.assign(window, {
    performance: {now: () => now}, crypto: {randomUUID: () => `test-session-${++uuid}`},
    navigator: {mediaDevices: {getUserMedia() { throw new Error('The presentation must never open a camera.'); }}},
    setInterval(fn, interval) {timers.set(++timerId, {fn, interval, next: now + interval}); return timerId;},
    clearInterval(id) {timers.delete(id);},
    setTimeout(fn, delay) {timers.set(++timerId, {fn, once: true, next: now + delay}); return timerId;},
    clearTimeout(id) {timers.delete(id);},
  });
  Object.assign(document, {defaultView: window, hidden: false, baseURI: 'https://jiaruilei.github.io/CE2134-TTG-Workshop/'});
  Object.assign(frame, {ownerDocument: document, contentWindow: child, dataset: {webSrc: CHILD + '/'}});
  const input = new SharedHandInput({frame, onStatus: (text, state) => statuses.push({text, state}),
    onProgress: value => progress.push(value), onTrigger: () => fired++});
  const dispatch = (data, {origin = CHILD, source = child} = {}) => {
    const event = new Event('message');
    Object.assign(event, {data, origin, source}); window.dispatchEvent(event);
  };
  const advance = t => {
    now = t;
    for (const [id, timer] of [...timers]) {
      if (timer.next <= now) {
        if(timer.once) timers.delete(id); else timer.next = now + timer.interval;
        timer.fn();
      }
    }
  };
  return {input, frame, window, document, child, statuses, progress, messages, timers, advance, dispatch,
    get fired() {return fired;}, get session() {return input._session?.id;},
    status(state = 'ready', message = 'Lab camera ready.') {dispatch(envelope(input._session.id, 'status', {state, message}));},
    sample(t, landmarks = hands(), overrides = {}) {
      advance(t); dispatch(envelope(input._session.id, 'frame', {
        seq: ++seq, timestamp: t + 10000, width: 640, height: 480, landmarks, ...overrides,
      }));
    },
  };
}

function recordingDetector(input) {
  const calls = [];
  let resets = 0, trigger = false;
  input._session.detector = {reset() {resets++;}, update(...args) {
    calls.push(args); return {message: 'Tracking', phase: 'tracking', progress: trigger ? 1 : .2, triggered: trigger};
  }};
  return {calls, get resets() {return resets;}, set trigger(value) {trigger = value;}};
}

test('two-origin subscription shares coordinates without opening a second camera', async () => {
  const h = harness(); assert.equal(await h.input.start(), true);
  assert.deepEqual(h.messages[0], {data: envelope(h.session, 'start'), targetOrigin: CHILD});
  h.status(); const detector = recordingDetector(h.input);
  h.sample(123, hands(), {timestamp: 500000});
  assert.equal(detector.calls.length, 1);
  assert.equal(detector.calls[0][1], 123, 'gesture timing is the parent receive clock');
  assert.deepEqual(detector.calls[0][2], {width: 640, height: 480});
  h.advance(2000);
  assert.equal(h.messages.at(-1).data.type, 'heartbeat');
  assert.equal(h.messages.at(-1).targetOrigin, CHILD);
  h.input.stop(); assert.equal(h.messages.at(-1).data.type, 'stop');
  assert.equal(h.timers.size, 0); assert.equal(h.input.active, false);
});

test('wrong origin, sibling frame, protocol, version and stale session cannot feed the detector', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  const valid = envelope(h.session, 'frame', {seq: 1, timestamp: 20, width: 640, height: 480, landmarks: hands()});
  h.dispatch(valid, {origin: 'https://attacker.invalid'});
  h.dispatch(valid, {source: {}});
  h.dispatch({...valid, channel: 'other'}); h.dispatch({...valid, version: 2});
  h.dispatch({...valid, session: 'old'}); h.dispatch({...valid, session: null});
  h.dispatch({...valid, type: 'start'});
  assert.equal(detector.calls.length, 0);
  h.dispatch(valid); assert.equal(detector.calls.length, 1); h.input.dispose();
});

test('malformed landmarks, dimensions, timestamps and sequence numbers are ignored', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  for (const overrides of [
    {seq: -1}, {seq: 1.5}, {timestamp: NaN}, {timestamp: Infinity}, {width: 0}, {height: 9000},
    {width: 1.5}, {landmarks: [hands()[0].slice(1)]}, {landmarks: [[], [], []]}, {landmarks: null},
    {landmarks: [[...hands()[0].slice(0, 20), {x: Infinity, y: .5}]]},
    {landmarks: [[...hands()[0].slice(0, 20), {x: .5, y: .5, z: NaN}]]},
    {landmarks: [[...hands()[0].slice(0, 20), {x: 50, y: .5}]]},
  ]) h.sample(100, hands(), overrides);
  assert.equal(detector.calls.length, 0); h.input.dispose();
});

test('duplicate or out-of-order sequence and remote timestamps cannot replay a frame', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  h.sample(100, hands(), {seq: 4, timestamp: 40});
  h.sample(150, hands(), {seq: 4, timestamp: 41});
  h.sample(200, hands(), {seq: 3, timestamp: 42});
  h.sample(250, hands(), {seq: 5, timestamp: 40});
  h.sample(300, hands(), {seq: 6, timestamp: 39});
  assert.equal(detector.calls.length, 1);
  h.sample(350, hands(), {seq: 7, timestamp: 43});
  assert.equal(detector.calls.length, 2); h.input.dispose();
});

test('an empty observation reaches the detector and stale delivery resets its sequence', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  h.sample(100, []); assert.deepEqual(detector.calls[0][0], []);
  h.advance(750); assert.ok(detector.resets >= 1);
  h.sample(800); assert.equal(detector.calls.length, 2); h.input.dispose();
});

test('gesture suspension retains the subscription and heartbeat, then rearms a fresh detector', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  detector.trigger = true; h.sample(100); assert.equal(h.fired, 1);
  h.sample(200); assert.equal(detector.calls.length, 1); assert.equal(h.fired, 1);
  h.advance(2100); assert.equal(h.messages.at(-1).data.type, 'heartbeat');
  assert.equal(h.messages.filter(x => x.data.type === 'start').length, 1);
  assert.equal(h.messages.filter(x => x.data.type === 'stop').length, 0);
  h.input.setEnabled(true); assert.ok(detector.resets > 0);
  detector.trigger = false; h.sample(2200); assert.equal(detector.calls.length, 2);
  detector.trigger = true; h.sample(2300); assert.equal(h.fired, 2); h.input.dispose();
});

test('disabled pending readiness never triggers and ready status reflects playback pause', async () => {
  const h = harness(); await h.input.start(); h.input.setEnabled(false); h.status();
  const detector = recordingDetector(h.input); detector.trigger = true;
  h.sample(100); assert.equal(detector.calls.length, 0); assert.equal(h.fired, 0);
  assert.equal(h.statuses.at(-1).state, 'paused'); h.input.dispose();
});

test('callback stop or disarm suppresses a trigger already computed for the frame', async () => {
  for (const mode of ['disarm', 'stop']) {
    const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
    detector.trigger = true;
    if (mode === 'disarm') h.input.onProgress = value => {if (value === 1) h.input.setEnabled(false);};
    else h.input.onStatus = (text, state) => {if (state === 'triggered') h.input.stop();};
    h.sample(100); assert.equal(h.fired, 0); h.input.dispose();
  }
});

test('iframe reload and trusted hello rotate sessions; delayed previous-session replies are rejected', async () => {
  const h = harness(); await h.input.start(); const first = h.session;
  h.frame.dispatchEvent(new Event('load')); const second = h.session;
  assert.notEqual(first, second);
  assert.deepEqual(h.messages.slice(-2).map(x => x.data.type), ['stop', 'start']);
  h.dispatch(envelope(first, 'status', {state: 'ready', message: 'Old'}));
  assert.equal(h.input._session.state, 'requesting');
  h.dispatch(envelope('', 'hello'), {origin: 'https://attacker.invalid'}); assert.equal(h.session, second);
  h.dispatch(envelope('', 'hello')); assert.notEqual(h.session, second);
  assert.equal(h.timers.size, 2); h.input.dispose();
});

test('leaving the slide, hiding the page and disposing release only the current subscription', async () => {
  const h = harness(); await h.input.start(); const first = h.session; h.input.stop();
  h.dispatch(envelope('', 'hello')); h.frame.dispatchEvent(new Event('load'));
  assert.equal(h.input.active, false);
  await h.input.start(); assert.notEqual(h.session, first);
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.input.active, false); assert.equal(h.timers.size, 0);
  assert.equal(await h.input.start(), false);
  h.document.hidden = false; await h.input.start();
  h.window.dispatchEvent(new Event('pagehide')); assert.equal(h.input.active, false);
  await h.input.start(); h.input.dispose(); assert.equal(h.timers.size, 0);
  assert.equal(await h.input.start(), false);
});

test('lab errors reset progress; malformed status cannot overwrite readiness', async () => {
  const h = harness(); await h.input.start(); h.status(); const detector = recordingDetector(h.input);
  h.sample(100); h.status('error', 'Permission denied.');
  assert.ok(detector.resets > 0); assert.equal(h.progress.at(-1), 0);
  h.sample(200); assert.equal(detector.calls.length, 1);
  h.status('ready'); h.status('unknown'); assert.equal(h.input._session.state, 'ready');
  h.status('error', 'x'.repeat(501)); assert.equal(h.input._session.state, 'ready');
  h.sample(300); assert.equal(detector.calls.length, 2); h.input.dispose();
});

test('real clap landmarks from the lab trigger once and require separation after playback', async () => {
  const h = harness(); await h.input.start(); h.status();
  const clap = start => {
    for (let i = 0; i <= 5; i++) h.sample(start + i * 100, hands());
    for (let i = 1; i <= 13; i++) h.sample(start + 500 + i * 100, hands(i / 13));
  };
  clap(100); assert.equal(h.fired, 1);
  for (let t = 2000; t <= 2400; t += 100) h.sample(t, hands(1));
  assert.equal(h.fired, 1); assert.equal(h.input.active, true);
  h.input.setEnabled(true);
  for (let t = 2500; t <= 3200; t += 100) h.sample(t, hands(1));
  assert.equal(h.fired, 1, 'remaining with hands together must not replay');
  clap(3300); assert.equal(h.fired, 2);
  assert.equal(h.messages.filter(message => message.data.type === 'start').length, 1);
  assert.equal(h.messages.filter(message => message.data.type === 'stop').length, 0);
  h.input.dispose();
});

test('render suspension waits for the current authenticated acknowledgement and heartbeat repeats the desired state', async () => {
  const h = harness(); await h.input.start(); h.status();
  const pending = h.input.setLabPaused(true);
  const requestId = h.messages.at(-1).data.requestId;
  assert.equal(h.messages.at(-1).data.type, 'render-control');
  assert.equal(h.messages.at(-1).data.paused, true);
  let settled = false; pending.then(() => {settled = true;});
  const ack = envelope(h.session, 'render-status', {requestId, paused: true, state: 'paused', message: 'Paused'});
  h.dispatch(ack, {origin: 'https://attacker.invalid'});
  h.dispatch(ack, {source: {}});
  h.dispatch({...ack, session: 'old-session'});
  h.dispatch({...ack, requestId: requestId - 1});
  h.dispatch({...ack, paused: false});
  h.dispatch({...ack, state: 'ready'});
  await Promise.resolve(); assert.equal(settled, false);
  h.advance(2000);
  assert.deepEqual(h.messages.at(-1).data, envelope(h.session, 'heartbeat', {requestId, renderPaused: true}));
  h.dispatch(ack); assert.equal(await pending, true);
  assert.equal(h.timers.size, 2, 'acknowledgement clears its timeout');
  const resume = h.input.setLabPaused(false);
  const nextId = h.messages.at(-1).data.requestId;
  h.dispatch({...ack, requestId: nextId, paused: false, state: 'recovering'});
  h.dispatch({...ack, requestId: nextId, paused: false, state: 'ready'});
  assert.equal(await resume, true);
  h.input.dispose();
});

test('superseding a pause cancels its wait and stale replies cannot satisfy resume', async () => {
  const h = harness(); await h.input.start();
  const pause = h.input.setLabPaused(true);
  const old = h.messages.at(-1).data.requestId;
  const resume = h.input.setLabPaused(false);
  assert.equal(await pause, false);
  assert.equal(h.input.setLabPaused(false), resume, 'duplicate pending request uses one wait');
  h.dispatch(envelope(h.session, 'render-status', {requestId: old, paused: true, state: 'paused', message: 'Old'}));
  h.dispatch(envelope(h.session, 'render-status', {requestId: old + 1, paused: false, state: 'ready', message: 'Resumed'}));
  assert.equal(await resume, true);
  h.input.dispose();
});

test('render timeout and child error settle safely without removing the shared camera subscription', async () => {
  const h = harness(); await h.input.start();
  const pause = h.input.setLabPaused(true, {timeoutMs: 500});
  h.advance(501); assert.equal(await pause, false); assert.equal(h.input.active, true);
  const resume = h.input.setLabPaused(false);
  h.dispatch(envelope(h.session, 'render-status', {requestId: h.messages.at(-1).data.requestId, paused: false, state: 'error', message: 'Unable to render'}));
  assert.equal(await resume, false);
  h.input.dispose(); assert.equal(h.timers.size, 0);
});

test('iframe reload preserves covered state but cancels the old wait; stopping releases it', async () => {
  const h = harness(); await h.input.start();
  const pause = h.input.setLabPaused(true), oldSession = h.session;
  h.frame.dispatchEvent(new Event('load'));
  assert.equal(await pause, false);
  assert.notEqual(h.session, oldSession);
  assert.equal(h.messages.at(-1).data.type, 'start');
  assert.equal(h.messages.at(-1).data.renderPaused, true);
  const request = h.input.setLabPaused(true);
  h.input.stop(); assert.equal(await request, false);
  await h.input.start();
  assert.equal(h.messages.at(-1).data.renderPaused, false);
  h.input.dispose();
});
