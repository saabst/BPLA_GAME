import type { TargetBlueprint, WindowTargetSpec } from './types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ResolvedWindowSpec extends Required<Omit<WindowTargetSpec, 'label'>> {
  label: string;
}

export const HQ_BUILDING_DIMENSIONS = {
  width: 30,
  height: 15,
  depth: 16,
} as const;

const DEFAULT_WINDOW: ResolvedWindowSpec = {
  localX: -6,
  height: 10.6,
  localZ: HQ_BUILDING_DIMENSIONS.depth / 2,
  radiusM: 3.4,
  widthM: 3.2,
  heightM: 2.6,
  label: 'ОКНО ШТАБА',
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getWindowSpec(bp: Pick<TargetBlueprint, 'window'>): ResolvedWindowSpec {
  const w = bp.window;
  return {
    localX: finiteOr(w?.localX, DEFAULT_WINDOW.localX),
    height: finiteOr(w?.height, DEFAULT_WINDOW.height),
    localZ: finiteOr(w?.localZ, DEFAULT_WINDOW.localZ),
    radiusM: Math.max(1.2, finiteOr(w?.radiusM, DEFAULT_WINDOW.radiusM)),
    widthM: Math.max(1, finiteOr(w?.widthM, DEFAULT_WINDOW.widthM)),
    heightM: Math.max(1, finiteOr(w?.heightM, DEFAULT_WINDOW.heightM)),
    label: w?.label ?? DEFAULT_WINDOW.label,
  };
}

/** Поворот локальной точки здания вокруг вертикальной оси Y (совместимо с Three.js rotation.y). */
export function rotateLocalToWorld(origin: Vec3Like, local: Vec3Like, headingRad: number): Vec3Like {
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return {
    x: origin.x + local.x * c + local.z * s,
    y: origin.y + local.y,
    z: origin.z - local.x * s + local.z * c,
  };
}

export function worldToLocal(point: Vec3Like, origin: Vec3Like, headingRad: number): Vec3Like {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return {
    x: dx * c - dz * s,
    y: point.y - origin.y,
    z: dx * s + dz * c,
  };
}

export function getWindowWorldPoint(origin: Vec3Like, headingRad: number, bp: Pick<TargetBlueprint, 'window'>): Vec3Like {
  const spec = getWindowSpec(bp);
  return rotateLocalToWorld(origin, { x: spec.localX, y: spec.height, z: spec.localZ }, headingRad);
}

export function closestPointOnSegment(point: Vec3Like, a: Vec3Like, b: Vec3Like): { point: Vec3Like; t: number; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  const t =
    lengthSq <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / lengthSq
          )
        );
  const closest = {
    x: a.x + abx * t,
    y: a.y + aby * t,
    z: a.z + abz * t,
  };
  return {
    point: closest,
    t,
    distance: Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z),
  };
}

export function segmentPointDistance(point: Vec3Like, a: Vec3Like, b: Vec3Like): number {
  return closestPointOnSegment(point, a, b).distance;
}

/**
 * Пересечение отрезка с AABB здания в локальных координатах.
 * Возвращает параметр входа 0..1 или null. Устойчиво к отрезкам, параллельным граням.
 */
export function segmentIntersectsAabb(
  a: Vec3Like,
  b: Vec3Like,
  min: Vec3Like,
  max: Vec3Like
): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: Array<keyof Vec3Like> = ['x', 'y', 'z'];

  for (const axis of axes) {
    const origin = a[axis];
    const direction = b[axis] - a[axis];
    if (Math.abs(direction) < 1e-9) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }

    const invDir = 1 / direction;
    let t0 = (min[axis] - origin) * invDir;
    let t1 = (max[axis] - origin) * invDir;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return null;
  }

  return tMin;
}

export type WindowStrikeKind = 'window' | 'facade' | 'none';

export interface WindowStrikeResult {
  kind: WindowStrikeKind;
  distanceToWindowM: number;
  impactPoint: Vec3Like | null;
  windowCenter: Vec3Like;
}

/**
 * Классифицирует пролёт БПЛА за один физический шаг:
 * - window: отрезок траектории прошёл в допустимом радиусе от центра окна;
 * - facade: отрезок пересёк объём здания, но мимо окна;
 * - none: здания не коснулись.
 */
export function classifyWindowStrike(
  prev: Vec3Like,
  next: Vec3Like,
  buildingOrigin: Vec3Like,
  headingRad: number,
  bp: Pick<TargetBlueprint, 'window'>
): WindowStrikeResult {
  const spec = getWindowSpec(bp);
  const windowCenter = getWindowWorldPoint(buildingOrigin, headingRad, bp);
  const closest = closestPointOnSegment(windowCenter, prev, next);

  if (closest.distance <= spec.radiusM) {
    return {
      kind: 'window',
      distanceToWindowM: closest.distance,
      impactPoint: closest.point,
      windowCenter,
    };
  }

  const localPrev = worldToLocal(prev, buildingOrigin, headingRad);
  const localNext = worldToLocal(next, buildingOrigin, headingRad);
  const pad = 0.45;
  const min = {
    x: -HQ_BUILDING_DIMENSIONS.width / 2 - pad,
    y: -0.2,
    z: -HQ_BUILDING_DIMENSIONS.depth / 2 - pad,
  };
  const max = {
    x: HQ_BUILDING_DIMENSIONS.width / 2 + pad,
    y: HQ_BUILDING_DIMENSIONS.height + pad,
    z: HQ_BUILDING_DIMENSIONS.depth / 2 + pad,
  };
  const hitT = segmentIntersectsAabb(localPrev, localNext, min, max);

  if (hitT === null) {
    return {
      kind: 'none',
      distanceToWindowM: closest.distance,
      impactPoint: null,
      windowCenter,
    };
  }

  const impactPoint = {
    x: prev.x + (next.x - prev.x) * hitT,
    y: prev.y + (next.y - prev.y) * hitT,
    z: prev.z + (next.z - prev.z) * hitT,
  };

  return {
    kind: 'facade',
    distanceToWindowM: Math.hypot(
      impactPoint.x - windowCenter.x,
      impactPoint.y - windowCenter.y,
      impactPoint.z - windowCenter.z
    ),
    impactPoint,
    windowCenter,
  };
}
