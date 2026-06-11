// Pure pan/tilt DMX -> beam direction, shared by the renderer (app.js) and its unit test.
// No Three.js / DOM dependency so it runs in vitest too.
//
// Builder coords: +X audience-right, +Y upstage, +Z up. Convention matches aim() in
// scripts/build-show.ts: pan 128 = beam straight upstage, +pan -> audience-right
// (panRange deg over 0-255); tilt 128 = tiltCentreDepr deg below horizontal, +tilt =
// steeper down (tiltRange deg over 0-255).

export const HEAD_DEFAULTS = { panRange: 540, tiltRange: 270, tiltCentreDepr: 37.5 };

/** Unit beam direction [x,y,z] in builder coords for a pan/tilt DMX pair. */
export function beamDirBuilder(pan, tilt, head = HEAD_DEFAULTS) {
  const azDeg = (pan - 128) * (head.panRange / 255); // from +Y (upstage) toward +X
  const deprDeg = head.tiltCentreDepr + (tilt - 128) * (head.tiltRange / 255); // below horizontal
  const az = (azDeg * Math.PI) / 180;
  const depr = (deprDeg * Math.PI) / 180;
  const bx = Math.sin(az) * Math.cos(depr);
  const by = Math.cos(az) * Math.cos(depr);
  const bz = -Math.sin(depr); // downward when depressed below horizontal
  const len = Math.hypot(bx, by, bz) || 1;
  return [bx / len, by / len, bz / len];
}
