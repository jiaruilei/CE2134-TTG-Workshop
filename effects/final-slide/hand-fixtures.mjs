// Synthetic image landmarks for tests; no camera images or personal data.
export function hands(progress = 0, {aspect = 4/3, mirror = false, swap = false, roll = 0,
  leftProgress = progress, rightProgress = progress, converge = true} = {}) {
  const pair = [-1, 1].map((side, i) => {
    const p = i === 0 ? leftProgress : rightProgress;
    const angle = p * Math.PI / 2, size = .075;
    const center = {x: (.5 + side * (converge ? .22 - progress * .13 : .22)) * aspect, y: .60 - progress * .05};
    const direction = {x: side * Math.cos(angle), y: -Math.sin(angle)};
    const across = {x: -direction.y, y: direction.x};
    const landmark = (along, lateral = 0) => {
      const x = center.x + direction.x * size * along + across.x * size * lateral;
      const y = center.y + direction.y * size * along + across.y * size * lateral;
      const r = roll * Math.PI / 180;
      const xr = .5 * aspect + (x - .5 * aspect) * Math.cos(r) - (y - .6) * Math.sin(r);
      const yr = .6 + (x - .5 * aspect) * Math.sin(r) + (y - .6) * Math.cos(r);
      return {x: mirror ? 1 - xr / aspect : xr / aspect, y: yr, z: 0};
    };
    const points = Array.from({length: 21}, () => landmark(1));
    points[0] = landmark(-.65);
    for (const [base, lateral] of [[5,-.35],[9,0],[13,.22],[17,.42]]) {
      for (let j = 0; j < 4; j++) points[base + j] = landmark(.35 + j * .3, lateral);
    }
    return points;
  });
  return swap ? pair.reverse() : pair;
}
