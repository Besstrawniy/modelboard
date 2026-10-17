export type StrokePoint = { x: number; y: number };
export type GeometryStroke = { points: StrokePoint[]; width: number };

export function freehandPath(points: StrokePoint[]) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0.01`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const next = points[i + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function pointSegmentDistance(point: StrokePoint, start: StrokePoint, end: StrokePoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function cross(a: StrokePoint, b: StrokePoint, c: StrokePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentDistance(a: StrokePoint, b: StrokePoint, c: StrokePoint, d: StrokePoint) {
  if (Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) &&
    cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

const midpoint = (a: StrokePoint, b: StrokePoint): StrokePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Adaptive subdivision follows the same quadratic curves as the rendered SVG. */
export function flattenFreehandStroke(points: StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length < 3) return [...points];
  const result = [points[0]];
  const flatten = (start: StrokePoint, control: StrokePoint, end: StrokePoint, depth: number) => {
    if (depth >= 12 || pointSegmentDistance(control, start, end) <= Math.max(.001, tolerance)) {
      result.push(end);
      return;
    }
    const left = midpoint(start, control);
    const right = midpoint(control, end);
    const middle = midpoint(left, right);
    flatten(start, left, middle, depth + 1);
    flatten(middle, right, end, depth + 1);
  };
  for (let i = 1; i < points.length - 1; i++) {
    flatten(result[result.length - 1], points[i], midpoint(points[i], points[i + 1]), 0);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function prepareFreehandStroke(stroke: GeometryStroke, zoom: number) {
  const points = flattenFreehandStroke(stroke.points, .25 / Math.max(.01, zoom));
  const bounds = points.reduce((bounds, point) => ({
    left: Math.min(bounds.left, point.x), right: Math.max(bounds.right, point.x),
    top: Math.min(bounds.top, point.y), bottom: Math.max(bounds.bottom, point.y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  return { points, bounds };
}

export function eraserHitsStroke(stroke: GeometryStroke, start: StrokePoint, end: StrokePoint, zoom: number,
  prepared = prepareFreehandStroke(stroke, zoom), radiusPixels = 8) {
  if (!prepared.points.length) return false;
  const radius = radiusPixels / Math.max(.01, zoom) + stroke.width / 2;
  const { bounds, points } = prepared;
  if (Math.max(start.x, end.x) < bounds.left - radius || Math.min(start.x, end.x) > bounds.right + radius ||
    Math.max(start.y, end.y) < bounds.top - radius || Math.min(start.y, end.y) > bounds.bottom + radius) return false;
  if (points.length === 1) return pointSegmentDistance(points[0], start, end) <= radius;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistance(start, end, points[i - 1], points[i]) <= radius) return true;
  }
  return false;
}

export function appendFreehandPoint(points: StrokePoint[], point: StrokePoint, zoom: number, force = false) {
  const previous = points[points.length - 1];
  const distance = previous ? Math.hypot(previous.x - point.x, previous.y - point.y) : Infinity;
  if (distance > (force ? .001 : 1.5 / Math.max(.01, zoom))) points.push(point);
}
