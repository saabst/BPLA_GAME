export type CameraMode = 'flir' | 'bhot' | 'eo' | 'synth';

export type WarheadType = 'of50' | 'thermite' | 'kometa';

export interface WarheadSpec {
  id: WarheadType;
  code: string;
  name: string;
  badge: string;
  description: string;
  blastRadius: number;
  secondaryRadius: number;
  maxBoostMps: number;
  stealthCeilingM: number; // ниже этой высоты ЗРК не может навестись
  ewResistance: number;    // 0..1 снижение помех РЭБ
}

export const WARHEAD_SPECS: Record<WarheadType, WarheadSpec> = {
  of50: {
    id: 'of50',
    code: 'ОФБЧ-50',
    name: 'ОФБЧ-50 «ОСКОЛОК»',
    badge: 'УНИВЕРСАЛ · 50 КГ',
    description: 'Штатная осколочно-фугасная БЧ повышенного могущества. Широкое осколочное поле (24 м) надёжно поражает РЛС, ЗСУ и стоянку авиации.',
    blastRadius: 24,
    secondaryRadius: 95,
    maxBoostMps: 88, // ~317 км/ч
    stealthCeilingM: 58,
    ewResistance: 0.0,
  },
  thermite: {
    id: 'thermite',
    code: 'КЗБЧ-45',
    name: 'КЗБЧ-45 «ТЕРМИТ-К»',
    badge: 'БРОНЕБОЙНО-ЗАЖИГАТ.',
    description: 'Кумулятивное ядро + зажигательные элементы (2500°C). Идеальна для бункеров, танковых колонн и вызывает гигантскую детонацию складов ГСМ/БК (до 130 м)!',
    blastRadius: 19,
    secondaryRadius: 130,
    maxBoostMps: 93, // ~335 км/ч
    stealthCeilingM: 58,
    ewResistance: 0.0,
  },
  kometa: {
    id: 'kometa',
    code: 'КОМЕТА-М',
    name: 'МОД. «НОЧНОЙ ПРИЗРАК»',
    badge: 'АНТИ-РЭБ + СТЕЛС',
    description: '8-элементная антенна «Комета-М» и радиопоглощающий карбон: подавляет помехи РЭБ на 65% и скрывает борт от ЗРК вплоть до высоты 92 м!',
    blastRadius: 16,
    secondaryRadius: 85,
    maxBoostMps: 90, // ~324 км/ч
    stealthCeilingM: 92,
    ewResistance: 0.65,
  },
};

export type TargetKind =
  | 'radar'        // РЛС обнаружения и целеуказания
  | 'sam'          // Пусковая установка ЗРК
  | 'ew'           // Мобильная станция РЭБ
  | 'fuel'         // Резервуарный парк ГСМ
  | 'tank'         // Основной боевой танк
  | 'supply_truck' // Грузовик снабжения с БК
  | 'aa_gun'       // Зенитная установка / мобильная огневая группа ПВО
  | 'bunker'       // Защищенный командный пункт (бункер)
  | 'aircraft'     // Военный самолет на стоянке аэродрома
  | 'hq_window';   // Штабное здание: поражается только точным попаданием в отмеченное окно

/** Геометрия окна-цели на фасаде штабного здания в локальных координатах модели. */
export interface WindowTargetSpec {
  /** Смещение центра окна влево/вправо от центра фасада, м. */
  localX: number;
  /** Высота центра окна над землёй, м. */
  height: number;
  /** Глубина фасада от центра здания, м (обычно +8 для здания глубиной 16 м). */
  localZ?: number;
  /** Допустимое отклонение от центра окна для засчитывания точного попадания, м. */
  radiusM?: number;
  widthM?: number;
  heightM?: number;
  label?: string;
}

export interface TargetBlueprint {
  id: string;
  kind: TargetKind;
  name: string;
  codeName: string;
  x: number;
  z: number;
  rotation?: number;
  isPrimary: boolean;
  /** Маршрут патрулирования / движения колонны */
  patrolPath?: Array<{ x: number; z: number }>;
  moveSpeed?: number;
  /** Радиус купола РЭБ для типа ew */
  ewRadius?: number;
  /** Только для kind === 'hq_window': точное окно, в которое нужно влететь. */
  window?: WindowTargetSpec;
}

export interface RadioLine {
  speaker: string;       // например: КП «ГРАНИТ»
  role: string;          // Командир дивизиона Ру-войск
  text: string;
  tone?: 'command' | 'warn' | 'praise' | 'intel';
}

export interface TrainingGateBlueprint {
  id: string;
  label: string;
  x: number;
  agl: number; // высота центра кольца над землей
  z: number;
}

export interface MissionDef {
  id: number;
  chapterLabel: string;
  code: string;
  title: string;
  sector: string;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  weatherLabel: string;
  isTutorial?: boolean;
  isGenerated?: boolean;
  storyLead: string;
  briefing: string[];
  tacticalTip: string;
  radioIntro: RadioLine;
  radioMid?: RadioLine;
  radioHit: RadioLine;
  radioVictory: string;
  dronesCount: number;
  spawnPos: { x: number; y: number; z: number };
  spawnHeading: number;
  hasAirfield?: boolean;
  riverZ?: number;
  roadAngle?: number;
  trainingGates?: TrainingGateBlueprint[];
  targets: TargetBlueprint[];
}

export interface FreeHuntConfig {
  scenario: 'convoy' | 'airdefense' | 'oildepot' | 'airbase' | 'window_hq';
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  intensity: 'normal' | 'hardcore';
}

export interface RadarBlip {
  relX: number; // -1..1
  relForward: number; // -1..1
  isPrimary: boolean;
  destroyed: boolean;
  isMissile?: boolean;
  isGate?: boolean;
}

export interface ProjectedTargetHUD {
  id: string;
  name: string;
  codeName: string;
  kind: TargetKind;
  isPrimary: boolean;
  destroyed: boolean;
  screenX: number; // 0..1
  screenY: number; // 0..1
  inFront: boolean;
  distance: number;
  /** Цель находится рядом с центром перекрестия. Это только визуальная подсказка, без автонаведения. */
  inCrosshair: boolean;
  isWindowTarget?: boolean;
  isFriendlyWingman?: boolean;
  isTrainingGate?: boolean;
}

export interface TelemetryData {
  callsign: string;
  droneIndex: number;
  totalDrones: number;
  warhead: WarheadType;
  speedKmh: number;
  altitudeM: number;
  aglM: number;
  pitchDeg: number;
  rollDeg: number;
  headingDeg: number;
  throttle: 'cruise' | 'boost' | 'brake';
  fuelPercent: number;
  signalQuality: number;
  ewInterference: number;
  lowAltStealth: boolean;
  stealthCeilingM: number;
  groundPullUpWarning: boolean;
  /** Ближайшая к перекрестию цель — только для HUD/расчёта TTI, управление остаётся ручным. */
  centerTargetName: string | null;
  centerTargetDist: number | null;
  timeToImpactSec: number | null;
  /** Фактические сглаженные отклонения рулей после фильтра входного сигнала, -1..1. */
  controlYaw: number;
  controlPitch: number;
  samWarning: boolean;
  samNearestDist: number | null;
  flakWarning: boolean;
  zoom: 1 | 2.5;
  cameraMode: CameraMode;
  projectedTargets: ProjectedTargetHUD[];
  radarBlips: RadarBlip[];
  flightTimeSec: number;
  hullIntegrity: number;
  gatesPassed: number;
  gatesTotal: number;
}

export interface ImpactReport {
  outcome:
    | 'direct_hit'
    | 'window_hit'
    | 'facade_hit'
    | 'splash_hit'
    | 'missed_ground'
    | 'shot_down'
    | 'ew_lost'
    | 'aborted';
  title: string;
  subtitle: string;
  destroyedTargets: string[];
  secondaryDetonation: boolean;
  /** Отклонение от центра окна-цели в метрах, если удар был по штабному зданию. */
  windowMissDistanceM?: number | null;
  impactPoint: { x: number; y: number; z: number };
  distanceToNearestPrimary: number;
  replayIndex: number;
}

// === СИСТЕМА 3D-ПОВТОРА ВЫЛЕТА («ЧЁРНЫЙ ЯЩИК ОК») ===
export type ReplayCameraAngle = 'fpv' | 'chase' | 'target_pov' | 'orlan';

export interface ReplayFrame {
  t: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speedKmh: number;
  aglM: number;
  rollDeg: number;
  pitchDeg: number;
  headingDeg: number;
  centerTargetId: string | null;
  zoom: 1 | 2.5;
  targetStates: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    heading: number;
  }>;
  samPositions: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }>;
  tracerPositions: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }>;
}

export interface SortieReplayRecord {
  index: number;
  callsign: string;
  warhead: WarheadType;
  frames: ReplayFrame[];
  impactTime: number;
  totalDuration: number; // impactTime + 3.6 сек наблюдения взрыва!
  impactPoint: { x: number; y: number; z: number };
  watchTargetPos: { x: number; y: number; z: number }; // точка на земле для ракурса «С земли у цели»
  destroyedBeforeIds: string[];
  destroyedDuringIds: string[];
  secondaryDetonation: boolean;
  thermiteFire: boolean;
  summaryLabel: string;
}

export interface ReplayStatus {
  callsign: string;
  warhead: WarheadType;
  currentTime: number;
  impactTime: number;
  totalDuration: number;
  playing: boolean;
  speed: 0.25 | 0.5 | 1;
  angle: ReplayCameraAngle;
  showTrail: boolean;
  speedKmh: number;
  aglM: number;
  impactTriggered: boolean;
}

export type GamePhase =
  | 'menu'
  | 'briefing'
  | 'flying'
  | 'static_cut'
  | 'recon'
  | 'replay'
  | 'debrief';

export type TutorialStep =
  | 'none'
  | 'steer_gates'
  | 'switch_sensor'
  | 'low_altitude'
  | 'manual_aim'
  | 'boost_impact'
  | 'second_target';

export interface ControlSettings {
  invertPitch: boolean;
  sensitivity: number; // 0.6 .. 1.6
  soundEnabled: boolean;
  highGraphics: boolean;
}

export interface FlightInput {
  yawRoll: number; // -1 .. 1 (влево / вправо)
  pitch: number;   // -1 .. 1
  boost: boolean;
  airbrake: boolean;
}
