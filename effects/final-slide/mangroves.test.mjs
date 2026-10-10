import test from 'node:test';
import assert from 'node:assert/strict';
import {MangroveStand, MANGROVE_ATLAS_URL} from './mangroves.mjs';

const stillWater = () => ({height: 1, velocityX: 0, velocityY: 0, velocityZ: 0});
const flowingWater = () => ({height: 1, velocityX: .8, velocityY: .2, velocityZ: .4});
const dryWater = () => ({height: -6, velocityX: 0, velocityY: 0, velocityZ: 0});
const frame = (stand, time, sampleWater = stillWater, halfWidth = 8) => stand.update({time, sampleWater, halfWidth});
const tips = stand => stand.plants.map(plant => Array.from(plant.rings.slice(-6, -3)));
const base = stand => stand.plants.map(plant => Array.from(plant.rings.slice(0, 18)));
const meanDelta = (a, b, axis) => a.reduce((sum, point, i) => sum + point[axis] - b[i][axis], 0) / a.length;

test('roots and lower woody stems stay fixed during filling and current', () => {
  const stand = new MangroveStand();
  frame(stand, 0, dryWater);
  const before = base(stand);
  for (let i = 1; i <= 240; i++) frame(stand, i / 60, flowingWater);
  assert.deepEqual(base(stand), before);
  assert.ok(stand.plants.every(plant => Math.abs(plant.rings[7] - stand.floor) < 1e-6));
});

test('still water never adds artificial waving', () => {
  const stand = new MangroveStand();
  const before = frame(stand, 0).vertices.slice();
  for (let i = 1; i <= 240; i++) frame(stand, i / 60);
  assert.deepEqual(stand.vertices, before);
});

test('upper stems bend gently with flow and settle after flow stops', () => {
  const stand = new MangroveStand();
  frame(stand, 0);
  const initial = tips(stand);
  for (let i = 1; i <= 240; i++) frame(stand, i / 60, flowingWater);
  const moved = tips(stand);
  assert.ok(meanDelta(moved, initial, 0) > .08);
  assert.ok(meanDelta(moved, initial, 2) > .035);
  assert.ok(meanDelta(moved, initial, 0) < .3, 'woody stems do not flap like grass');
  for (let i = 241; i <= 600; i++) frame(stand, i / 60);
  assert.ok(Math.abs(meanDelta(tips(stand), initial, 0)) < .0001);
  assert.ok(Math.abs(meanDelta(tips(stand), initial, 2)) < .0001);
});

test('partial submergence queries flow below the surface while crown is in air', () => {
  const stand = new MangroveStand();
  const level = -3.75;
  let wetQueries = 0, airQueries = 0;
  const shallow = (_x, y) => {
    const wet = y < level;
    if (wet) wetQueries++; else airQueries++;
    return {height: level, velocityX: wet ? 1.2 : 0, velocityY: 0, velocityZ: 0};
  };
  frame(stand, 0, shallow);
  const initial = tips(stand);
  for (let i = 1; i <= 180; i++) frame(stand, i / 60, shallow);
  assert.ok(wetQueries > 0 && airQueries > 0);
  assert.ok(meanDelta(tips(stand), initial, 0) > .005);
  assert.deepEqual(stand.plants.map(plant => plant.speedZ), [0, 0, 0, 0, 0, 0]);
});

test('atlas triangles stay in their respective columns with image-space UVs', () => {
  const stand = new MangroveStand();
  const mesh = frame(stand, 0);
  assert.equal(mesh.stride, 9);
  assert.equal(mesh.count, 216);
  assert.equal(mesh.vertices.length, mesh.count * mesh.stride);
  assert.match(new URL(MANGROVE_ATLAS_URL).pathname, /assets\/mangrove-saplings\.png$/);
  for (let plantIndex = 0; plantIndex < stand.plants.length; plantIndex++) {
    const plant = stand.plants[plantIndex];
    const start = plantIndex * stand.segments * 6 * mesh.stride;
    const end = start + stand.segments * 6 * mesh.stride;
    for (let i = start; i < end; i += mesh.stride) {
      const u = mesh.vertices[i + 3], v = mesh.vertices[i + 4];
      assert.ok(u > plant.variant / 3 && u < (plant.variant + 1) / 3);
      assert.ok(v > 0 && v < 1);
    }
    assert.ok(mesh.vertices[start + 4] > .99, 'bottom image maps below the planted root');
    assert.ok(mesh.vertices[end - mesh.stride + 4] < .001, 'top of image maps to the crown');
  }
});

test('replay resets accumulated stem motion and preserves deterministic layout', () => {
  const stand = new MangroveStand();
  const first = frame(stand, 0, dryWater).vertices.slice();
  for (let i = 1; i <= 180; i++) frame(stand, i / 60, flowingWater);
  assert.deepEqual(frame(stand, 0, dryWater).vertices, first);
  for (let i = 1; i <= 180; i++) frame(stand, i / 60, flowingWater);
  stand.reset();
  assert.deepEqual(frame(stand, 5, dryWater).vertices, first);
});

test('resize keeps plant identity, normalized roots, and back-to-front order', () => {
  const stand = new MangroveStand();
  const mesh = frame(stand, 0);
  const layout = stand.plants.map(plant => [plant.rootX, plant.rootZ, plant.height, plant.variant]);
  for (const halfWidth of [.7, 3, 12, 8]) {
    assert.equal(frame(stand, 0, stillWater, halfWidth), mesh);
    assert.deepEqual(stand.plants.map(plant => [plant.rootX, plant.rootZ, plant.height, plant.variant]), layout);
    assert.ok(stand.vertices.every(Number.isFinite));
  }
  const depth = stand.plants.map(plant => plant.rootZ);
  assert.deepEqual(depth, [...depth].sort((a, b) => a - b));
  assert.equal(new Set(stand.plants.map(plant => plant.variant)).size, 3);
});

test('large currents and invalid inputs remain finite and bounded', () => {
  const stand = new MangroveStand();
  for (let i = 0; i <= 600; i++) frame(stand, i / 30, () => ({height: 10, velocityX: 1e6, velocityZ: -1e6}));
  assert.ok(stand.vertices.every(Number.isFinite));
  for (const plant of stand.plants) {
    assert.ok(Math.abs(plant.bendX) <= plant.height * .12);
    assert.ok(Math.abs(plant.bendZ) <= plant.height * .12);
  }
  frame(stand, NaN, () => ({height: NaN, velocityX: Infinity, velocityZ: NaN}), NaN);
  assert.ok(stand.vertices.every(Number.isFinite));
});

test('damped stem response is consistent across common frame rates', () => {
  const slow = new MangroveStand(), fast = new MangroveStand();
  for (let i = 0; i <= 90; i++) frame(slow, i / 30, flowingWater);
  for (let i = 0; i <= 360; i++) frame(fast, i / 120, flowingWater);
  assert.ok(Math.abs(meanDelta(tips(slow), tips(fast), 0)) < .001);
  assert.ok(Math.abs(meanDelta(tips(slow), tips(fast), 2)) < .001);
});
