import type { FlightInput } from './types';

export interface StickVector {
  x: number;
  y: number;
  knobX: number;
  knobY: number;
  magnitude: number;
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * Преобразует смещение пальца/мыши от точки захвата в вектор штурвала.
 * Радиальная мёртвая зона убирает дрожь в центре, а экспонента даёт точную
 * работу малыми отклонениями и полный ход рулей только у края круга.
 */
export function computeStickFromDelta(
  dx: number,
  dy: number,
  maxRadius = 52,
  deadzone = 0.08,
  exponent = 1.22
): StickVector {
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;
  const safeRadius = Number.isFinite(maxRadius) && maxRadius > 0 ? maxRadius : 52;
  const safeDeadzone = clampNumber(deadzone, 0, 0.85, 0.08);
  const safeExponent = clampNumber(exponent, 0.6, 2.5, 1.22);

  const distance = Math.hypot(safeDx, safeDy);
  if (distance <= 0.0001) {
    return { x: 0, y: 0, knobX: 0, knobY: 0, magnitude: 0 };
  }

  const clampedDistance = Math.min(distance, safeRadius);
  const rawMagnitude = clampedDistance / safeRadius;
  const unitX = safeDx / distance;
  const unitY = safeDy / distance;

  const afterDeadzone =
    rawMagnitude <= safeDeadzone
      ? 0
      : (rawMagnitude - safeDeadzone) / (1 - safeDeadzone);
  const shapedMagnitude = Math.pow(Math.max(0, Math.min(1, afterDeadzone)), safeExponent);

  return {
    x: clampAxis(unitX * shapedMagnitude),
    y: clampAxis(unitY * shapedMagnitude),
    knobX: unitX * clampedDistance,
    knobY: unitY * clampedDistance,
    magnitude: shapedMagnitude,
  };
}

/** Кадрово-независимое экспоненциальное сглаживание одной оси руля. */
export function smoothAxis(current: number, target: number, dt: number, responsePerSec = 10): number {
  const safeCurrent = clampAxis(current);
  const safeTarget = clampAxis(target);
  const safeDt = clampNumber(dt, 0, 0.1, 0);
  const safeResponse = clampNumber(responsePerSec, 0.1, 40, 10);
  if (safeDt <= 0) return safeCurrent;
  const alpha = 1 - Math.exp(-safeResponse * safeDt);
  return clampAxis(safeCurrent + (safeTarget - safeCurrent) * alpha);
}

export function keyboardToAxes(keys: ReadonlySet<string>): { yawRoll: number; pitch: number } {
  const set = keys;
  const has = (key: string) => set.has(key) || set.has(key.toLowerCase());
  return {
    yawRoll:
      (has('d') || has('arrowright') ? 1 : 0) -
      (has('a') || has('arrowleft') ? 1 : 0),
    pitch:
      (has('w') || has('arrowup') ? 1 : 0) -
      (has('s') || has('arrowdown') ? 1 : 0),
  };
}

/** Сенсорный штурвал имеет приоритет, пока указатель активен; иначе работает клавиатура. */
export function mergeAxes(
  pointerActive: boolean,
  pointerAxes: { yawRoll: number; pitch: number },
  keyboardAxes: { yawRoll: number; pitch: number }
): { yawRoll: number; pitch: number } {
  const source = pointerActive ? pointerAxes : keyboardAxes;
  return {
    yawRoll: clampAxis(source.yawRoll),
    pitch: clampAxis(source.pitch),
  };
}

/** Последний рубеж защиты симуляции от NaN/Infinity и выхода осей за диапазон. */
export function sanitizeFlightInput(input: Partial<FlightInput> | null | undefined): FlightInput {
  return {
    yawRoll: clampAxis(input?.yawRoll ?? 0),
    pitch: clampAxis(input?.pitch ?? 0),
    boost: Boolean(input?.boost),
    airbrake: Boolean(input?.airbrake),
  };
}

export function sanitizeSensitivity(value: number): number {
  return clampNumber(value, 0.6, 1.6, 1);
}
