import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampAxis,
  computeStickFromDelta,
  keyboardToAxes,
  mergeAxes,
  sanitizeFlightInput,
  sanitizeSensitivity,
  smoothAxis,
} from '../src/game/controlMath';
import { generateFreeHuntMission, MISSIONS } from '../src/game/missions';
import {
  classifyWindowStrike,
  closestPointOnSegment,
  getWindowWorldPoint,
  segmentIntersectsAabb,
} from '../src/game/windowStrike';

describe('управление штурвалом', () => {
  it('мёртвая зона убирает дрожь в центре', () => {
    const stick = computeStickFromDelta(2, -2, 52);
    assert.equal(stick.x, 0);
    assert.equal(stick.y, 0);
    assert.equal(stick.magnitude, 0);
  });

  it('полное диагональное отклонение ограничено единичной окружностью и радиусом ручки', () => {
    const stick = computeStickFromDelta(200, 200, 52);
    assert.ok(Math.hypot(stick.x, stick.y) <= 1.000001);
    assert.ok(Math.abs(Math.hypot(stick.knobX, stick.knobY) - 52) < 0.001);
    assert.ok(stick.x > 0.65 && stick.y > 0.65);
  });

  it('малые отклонения точнее линейных благодаря экспоненте', () => {
    const stick = computeStickFromDelta(15, 0, 52);
    assert.ok(stick.x > 0);
    assert.ok(stick.x < 15 / 52);
  });

  it('сглаживание почти не зависит от частоты кадров', () => {
    const oneStep = smoothAxis(0, 1, 0.1, 10);
    let manySteps = 0;
    for (let i = 0; i < 10; i++) manySteps = smoothAxis(manySteps, 1, 0.01, 10);
    assert.ok(Math.abs(oneStep - manySteps) < 0.002);
  });

  it('противоположные клавиши взаимно отменяются, а активный указатель имеет приоритет', () => {
    const keys = new Set(['w', 's', 'a']);
    assert.deepEqual(keyboardToAxes(keys), { yawRoll: -1, pitch: 0 });
    assert.deepEqual(
      mergeAxes(true, { yawRoll: 0.25, pitch: -0.5 }, { yawRoll: -1, pitch: 1 }),
      { yawRoll: 0.25, pitch: -0.5 }
    );
  });

  it('NaN, Infinity и выход за диапазон не могут сломать симуляцию', () => {
    assert.equal(clampAxis(Number.NaN), 0);
    assert.deepEqual(
      sanitizeFlightInput({ yawRoll: Infinity, pitch: -8, boost: true, airbrake: false }),
      { yawRoll: 0, pitch: -1, boost: true, airbrake: false }
    );
    assert.equal(sanitizeSensitivity(Number.NaN), 1);
    assert.equal(sanitizeSensitivity(99), 1.6);
  });
});

describe('попадание в окно штабного здания', () => {
  const origin = { x: -10, y: 0, z: -350 };
  const bp = {
    window: { localX: -6, height: 10.6, radiusM: 3.4, widthM: 3.2, heightM: 2.6 },
  };

  it('вычисляет мировую точку окна на фасаде', () => {
    assert.deepEqual(getWindowWorldPoint(origin, 0, bp), { x: -16, y: 10.6, z: -342 });
  });

  it('засчитывает проход точно через центр окна даже при туннелировании между кадрами', () => {
    const result = classifyWindowStrike(
      { x: -16, y: 10.6, z: -320 },
      { x: -16, y: 10.6, z: -365 },
      origin,
      0,
      bp
    );
    assert.equal(result.kind, 'window');
    assert.ok(result.distanceToWindowM < 0.01);
  });

  it('удар по фасаду рядом с окном не засчитывается как поражение штаба', () => {
    const result = classifyWindowStrike(
      { x: 2, y: 10.6, z: -320 },
      { x: 2, y: 10.6, z: -365 },
      origin,
      0,
      bp
    );
    assert.equal(result.kind, 'facade');
    assert.ok(result.distanceToWindowM > 3.4);
  });

  it('пролёт мимо здания не даёт ложного попадания', () => {
    const result = classifyWindowStrike(
      { x: 40, y: 10.6, z: -320 },
      { x: 40, y: 10.6, z: -380 },
      origin,
      0,
      bp
    );
    assert.equal(result.kind, 'none');
  });

  it('AABB устойчив к отрезкам, параллельным граням здания', () => {
    assert.equal(
      segmentIntersectsAabb(
        { x: 0, y: 20, z: 0 },
        { x: 0, y: 20, z: 20 },
        { x: -2, y: 0, z: -2 },
        { x: 2, y: 10, z: 2 }
      ),
      null
    );
    const closest = closestPointOnSegment({ x: 0, y: 3, z: 0 }, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    assert.equal(closest.distance, 3);
    assert.equal(closest.t, 0.5);
  });
});

describe('миссии и генератор свободной охоты', () => {
  it('кампания содержит отдельную операцию с окном штаба', () => {
    const mission = MISSIONS.find((m) => m.targets.some((t) => t.kind === 'hq_window'));
    assert.ok(mission, 'миссия с окном штаба должна существовать');
    const hq = mission.targets.filter((t) => t.kind === 'hq_window');
    assert.equal(hq.length, 1);
    assert.equal(hq[0]?.isPrimary, true);
    assert.ok(hq[0]?.window);
  });

  it('генератор window_hq создаёт 5 бортов и одну первичную цель-окно', () => {
    const mission = generateFreeHuntMission({
      scenario: 'window_hq',
      timeOfDay: 'night',
      intensity: 'normal',
    });
    assert.equal(mission.dronesCount, 5);
    assert.equal(mission.targets.filter((t) => t.kind === 'hq_window' && t.isPrimary).length, 1);
  });

  it('все миссии имеют уникальные ID целей и хотя бы одну основную цель', () => {
    for (const mission of MISSIONS) {
      const ids = mission.targets.map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, `дубли целей в миссии ${mission.id}`);
      assert.ok(mission.targets.some((t) => t.isPrimary), `нет основной цели в миссии ${mission.id}`);
      assert.ok(mission.dronesCount > 0, `нет бортов в миссии ${mission.id}`);
    }
  });
});
