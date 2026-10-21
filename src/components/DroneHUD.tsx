import {
  WARHEAD_SPECS,
  type CameraMode,
  type ImpactReport,
  type MissionDef,
  type RadioLine,
  type TelemetryData,
  type TutorialStep,
  type WarheadType,
} from '../game/types';
import { RadioCommsBanner, TutorialCoachCard } from './RadioAndTutorial';

interface DroneHUDProps {
  telemetry: TelemetryData;
  mission: MissionDef;
  tutorialStep: TutorialStep;
  radioMessage: RadioLine | null;
  onDismissRadio: () => void;
  onSkipGates: () => void;
  onAdvanceTutorialStep: () => void;
  onCycleCamera: () => void;
  onToggleZoom: () => void;
  onSelfDetonate: () => void;
  onOpenPause: () => void;
}

export function DroneHUD({
  telemetry,
  mission,
  tutorialStep,
  radioMessage,
  onDismissRadio,
  onSkipGates,
  onAdvanceTutorialStep,
  onCycleCamera,
  onToggleZoom,
  onSelfDetonate,
  onOpenPause,
}: DroneHUDProps) {
  const isBhot = telemetry.cameraMode === 'bhot';
  const modeAccent =
    telemetry.cameraMode === 'flir'
      ? '#d8fff0'
      : isBhot
      ? '#0b1815'
      : telemetry.cameraMode === 'synth'
      ? '#00ffc8'
      : '#9affb8';

  const crosshairStroke = telemetry.centerTargetName
    ? '#ffb02e'
    : isBhot
    ? '#0a1412'
    : '#ffffff';

  const modeLabel: Record<CameraMode, string> = {
    flir: 'ТПВ БЕЛ',
    bhot: 'ТПВ ЧЁРН',
    eo: 'ТВ ОПТИКА',
    synth: 'ВИЗОР ИИ',
  };

  const activeGateTarget = telemetry.projectedTargets.find((t) => t.isTrainingGate);
  const offscreenTarget =
    activeGateTarget ??
    telemetry.projectedTargets
      .filter((t) => !t.destroyed && t.isPrimary)
      .sort((a, b) => a.distance - b.distance)[0];

  const isOffscreen =
    offscreenTarget &&
    (!offscreenTarget.inFront ||
      offscreenTarget.screenX < 0.08 ||
      offscreenTarget.screenX > 0.92 ||
      offscreenTarget.screenY < 0.1 ||
      offscreenTarget.screenY > 0.86);

  let arrowAngleRad = 0;
  if (offscreenTarget && isOffscreen) {
    let dx = offscreenTarget.screenX - 0.5;
    let dy = offscreenTarget.screenY - 0.5;
    if (!offscreenTarget.inFront) {
      dx = -dx;
      dy = 0.45;
    }
    arrowAngleRad = Math.atan2(dy, dx);
  }

  const highlightSensors = tutorialStep === 'switch_sensor';
  const highlightAlt = tutorialStep === 'low_altitude';
  const whSpec = WARHEAD_SPECS[telemetry.warhead];

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none font-mono text-emerald-100"
    >
      {/* Оптическая виньетка и тонкая скан-сетка ГСН */}
      <div
        className="fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at center, transparent 55%, rgba(0, 6, 8, 0.52) 100%), repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,20,18,0.09) 3px)',
        }}
      />

      {/* === ВЕРХНЯЯ ПАНЕЛЬ ТЕЛЕМЕТРИИ И БЫСТРЫХ КНОПОК КАМЕРЫ === */}
      <div className="relative flex items-start justify-between px-2.5 pt-2 sm:px-4 sm:pt-3">
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1 bg-black/70 px-2.5 py-1.5 backdrop-blur-[2px] border border-emerald-400/30">
            <div className="flex items-center gap-2 text-[11px] sm:text-xs font-bold tracking-wider">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span>БОРТ {telemetry.callsign}</span>
              <span className="text-[10px] opacity-70">
                [{telemetry.droneIndex}/{telemetry.totalDrones}]
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] opacity-90">
              <span>СВЯЗЬ:</span>
              <span
                className={
                  telemetry.signalQuality < 45
                    ? 'text-amber-400 font-bold animate-pulse'
                    : 'text-emerald-300 font-bold'
                }
              >
                {telemetry.signalQuality}%
              </span>
              <span className="opacity-45">|</span>
              <span className="text-amber-200 font-bold">{whSpec.code}</span>
            </div>
          </div>

          {/* Круговой тактический навигатор целей (ИКО) */}
          <div className="hidden xs:block sm:block h-[66px] w-[66px] rounded-full bg-black/75 border border-emerald-400/35 p-0.5 shrink-0">
            <svg viewBox="-40 -40 80 80" className="h-full w-full">
              <circle cx="0" cy="0" r="24" fill="none" stroke="rgba(16,185,129,0.22)" strokeWidth="1" />
              <path
                d="M 0 0 L -19 -33 A 38 38 0 0 1 19 -33 Z"
                fill="rgba(0, 255, 200, 0.16)"
                stroke="rgba(0, 255, 200, 0.38)"
                strokeWidth="0.8"
              />
              {telemetry.radarBlips.map((b, idx) => (
                <circle
                  key={idx}
                  cx={b.relX * 36}
                  cy={-b.relForward * 36}
                  r={b.isGate ? 3.0 : b.isMissile ? 2.6 : b.isPrimary ? 2.8 : 2.1}
                  fill={
                    b.isGate
                      ? '#00ffc8'
                      : b.destroyed
                      ? '#666666'
                      : b.isMissile
                      ? '#ffffff'
                      : b.isPrimary
                      ? '#ff2a4d'
                      : '#ffaa22'
                  }
                />
              ))}
              <polygon points="0,-4 3.5,3 0,1.5 -3.5,3" fill="#00ffc8" />
            </svg>
          </div>
        </div>

        {/* Центральная шкала курса (Азимут) */}
        <div className="hidden md:flex flex-col items-center bg-black/70 px-3 py-1 border-b border-x border-emerald-400/30">
          <div className="text-[10px] tracking-[0.25em] opacity-65">{mission.sector}</div>
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest">
            <span className="opacity-45">{(telemetry.headingDeg + 350) % 360}°</span>
            <span className="px-1.5 py-0.5 bg-emerald-400/15 border border-emerald-300/40">
              {String(telemetry.headingDeg).padStart(3, '0')}°
            </span>
            <span className="opacity-45">{(telemetry.headingDeg + 10) % 360}°</span>
          </div>
        </div>

        {/* Правый блок: интерактивные переключатели Камеры, Зума, Подрыва и Паузы */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCycleCamera}
            className={`px-2.5 py-1.5 text-[10px] sm:text-xs font-bold tracking-wider border active:scale-95 ${
              highlightSensors
                ? 'bg-amber-500/40 border-amber-300 text-white animate-pulse shadow-[0_0_18px_rgba(245,158,11,0.75)]'
                : 'bg-black/75 hover:bg-emerald-950/85 border-emerald-300/45 text-emerald-200'
            }`}
          >
            {modeLabel[telemetry.cameraMode]}
          </button>
          <button
            type="button"
            onClick={onToggleZoom}
            className={`px-2 py-1.5 text-[10px] sm:text-xs font-bold border active:scale-95 ${
              highlightSensors
                ? 'bg-amber-500/35 border-amber-300 text-white animate-pulse'
                : telemetry.zoom === 2.5
                ? 'bg-emerald-500/35 border-emerald-300 text-white'
                : 'bg-black/75 border-emerald-300/40 text-emerald-200'
            }`}
          >
            {telemetry.zoom === 2.5 ? '2.5×' : '1.0×'}
          </button>
          <button
            type="button"
            onClick={onSelfDetonate}
            title="Самоликвидация борта"
            className="bg-red-950/80 hover:bg-red-900/90 active:scale-95 px-2 py-1.5 text-[10px] font-bold border border-red-500/60 text-red-200"
          >
            ПОДРЫВ
          </button>
          <button
            type="button"
            onClick={onOpenPause}
            className="bg-black/75 hover:bg-slate-900 active:scale-95 px-2.5 py-1.5 text-[10px] sm:text-xs font-bold border border-emerald-300/40 text-emerald-200"
          >
            ≡
          </button>
        </div>
      </div>

      {/* === КАРТОЧКА ИНСТРУКТОРА ОБУЧЕНИЯ / ЖИВОЙ РАДИОЭФИР КП «ГРАНИТ» === */}
      <div className="mt-1.5 flex flex-col gap-1.5 px-2.5">
        {tutorialStep !== 'none' ? (
          <TutorialCoachCard
            step={tutorialStep}
            gatesPassed={telemetry.gatesPassed}
            gatesTotal={telemetry.gatesTotal}
            aglM={telemetry.aglM}
            onSkipGates={onSkipGates}
            onAdvanceStep={onAdvanceTutorialStep}
          />
        ) : (
          <RadioCommsBanner message={radioMessage} onDismiss={onDismissRadio} />
        )}

        {/* Тревожные транспаранты ПВО / РЭБ / ССОЗ / Сверхмалой высоты */}
        <div className="flex flex-col items-center gap-1">
          {telemetry.samWarning && (
            <div className="bg-red-950/90 border border-red-500 px-3 py-1 text-[11px] sm:text-xs font-bold tracking-wider text-red-200 animate-pulse shadow-lg">
              ⚠ ПУСК РАКЕТЫ ЗРК ({telemetry.samNearestDist} М) — СНИЖАЙТЕСЬ НИЖЕ {telemetry.stealthCeilingM} М!
            </div>
          )}
          {telemetry.groundPullUpWarning && (
            <div className="bg-red-900/90 border-2 border-amber-300 px-3 py-0.5 text-[11px] font-bold tracking-widest text-amber-100 animate-pulse">
              ▲ ОПАСНО ЗЕМЛЯ ({telemetry.aglM} М) — ТЯНИ ШТУРВАЛ ВВЕРХ! ▲
            </div>
          )}
          {telemetry.ewInterference > 0.35 && (
            <div className="bg-amber-950/85 border border-amber-400/70 px-3 py-0.5 text-[10px] sm:text-[11px] font-bold tracking-wider text-amber-200">
              ⚡ ИЗЛУЧЕНИЕ РЭБ {Math.round(telemetry.ewInterference * 100)}%{' '}
              {telemetry.ewInterference > 0.68 ? '// СИЛЬНЫЙ ДРЕЙФ УПРАВЛЕНИЯ' : '// ПОМЕХИ ВИДЕОКАНАЛА'}
            </div>
          )}
          {telemetry.lowAltStealth && !telemetry.samWarning && !telemetry.groundPullUpWarning && (
            <div className="bg-emerald-950/80 border border-emerald-400/50 px-2.5 py-0.5 text-[10px] tracking-widest text-emerald-300">
              ◢ СКРЫТ РЕЛЬЕФОМ (&lt;{telemetry.stealthCeilingM}М) — РЛС ЗРК ОСЛЕПЛЕНА ◣
            </div>
          )}
        </div>
      </div>

      {/* === ЭЛЕКТРОННЫЕ РАМКИ ЦЕЛЕУКАЗАНИЯ В 3D-ПОЛЕ ЗРЕНИЯ КАМЕРЫ === */}
      {telemetry.projectedTargets.map((t) => {
        if (!t.inFront || t.screenX < -0.05 || t.screenX > 1.05 || t.screenY < -0.05 || t.screenY > 1.05) {
          return null;
        }
        if (t.isFriendlyWingman) {
          return (
            <div
              key={t.id}
              style={{
                left: `${t.screenX * 100}%`,
                top: `${t.screenY * 100}%`,
                transform: 'translate(-50%, -140%)',
              }}
              className="fixed flex flex-col items-center"
            >
              <span className="bg-black/75 border border-emerald-400/40 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                {t.codeName} · {t.distance}М
              </span>
            </div>
          );
        }
        if (t.isTrainingGate) {
          return (
            <div
              key={t.id}
              style={{
                left: `${t.screenX * 100}%`,
                top: `${t.screenY * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className="fixed flex flex-col items-center"
            >
              <span className="mt-12 bg-emerald-950/90 border border-emerald-300/70 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-200">
                ◎ {t.codeName} ({t.distance}М)
              </span>
            </div>
          );
        }
        if (t.destroyed) {
          return (
            <div
              key={t.id}
              style={{
                left: `${t.screenX * 100}%`,
                top: `${t.screenY * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className="fixed flex flex-col items-center opacity-70"
            >
              <span className="bg-black/60 px-1 text-[10px] text-neutral-200">✕ ПОРАЖЕНО</span>
            </div>
          );
        }

        const boxW = t.isWindowTarget ? 42 : t.inCrosshair ? 38 : 26;
        const boxH = t.isWindowTarget ? 30 : boxW;
        const borderColor = t.isWindowTarget
          ? '#ff2438'
          : t.inCrosshair
          ? '#ffb02e'
          : t.isPrimary
          ? '#00ffc8'
          : '#ffaa22';

        return (
          <div
            key={t.id}
            style={{
              left: `${t.screenX * 100}%`,
              top: `${t.screenY * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
            className="fixed flex flex-col items-center"
          >
            <div
              style={{
                width: `${boxW}px`,
                height: `${boxH}px`,
                borderColor,
                boxShadow: t.isWindowTarget
                  ? '0 0 14px rgba(255,36,56,0.75)'
                  : t.inCrosshair
                  ? '0 0 12px rgba(255,176,46,0.55)'
                  : undefined,
              }}
              className={`relative flex items-center justify-center ${
                t.isWindowTarget ? 'border-2' : t.inCrosshair ? 'border-2 border-dashed' : 'border opacity-90'
              }`}
            >
              {t.isWindowTarget && (
                <>
                  <div className="absolute h-full w-[1px] bg-red-400/70" />
                  <div className="absolute w-full h-[1px] bg-red-400/70" />
                </>
              )}
            </div>
            <div
              style={{ color: borderColor }}
              className="mt-1 whitespace-nowrap bg-black/80 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider"
            >
              {t.isWindowTarget ? '▦ ОКНО · ' : ''}
              {t.codeName} · {t.distance}М
            </div>
          </div>
        );
      })}

      {/* === ВНЕЭКРАННАЯ СТРЕЛКА ДОВОРОТА НА ЦЕЛЬ / СТВОР === */}
      {isOffscreen && offscreenTarget && (
        <div
          style={{
            left: `${50 + Math.cos(arrowAngleRad) * 36}%`,
            top: `${50 + Math.sin(arrowAngleRad) * 30}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed flex flex-col items-center gap-0.5"
        >
          <div
            style={{ transform: `rotate(${(arrowAngleRad * 180) / Math.PI + 90}deg)` }}
            className="text-lg font-bold text-emerald-400 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
          >
            ▲
          </div>
          <span className="bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200 border border-emerald-400/40">
            {offscreenTarget.codeName} ({offscreenTarget.distance}М)
          </span>
        </div>
      )}

      {/* === ЦЕНТРАЛЬНЫЙ АВИАГОРИЗОНТ И ПРИЦЕЛЬНАЯ СЕТКА КУРСОВОЙ ГСН === */}
      <div className="fixed inset-0 flex items-center justify-center">
        <svg
          viewBox="-160 -120 320 240"
          className="w-[260px] h-[195px] sm:w-[330px] sm:h-[248px] overflow-visible"
        >
          <g
            stroke={telemetry.centerTargetName ? '#ffb02e' : modeAccent}
            strokeWidth="1.5"
            fill="none"
            opacity="0.88"
          >
            <path d="M -48 -36 L -48 -24 M -48 -36 L -36 -36" />
            <path d="M 48 -36 L 48 -24 M 48 -36 L 36 -36" />
            <path d="M -48 36 L -48 24 M -48 36 L -36 36" />
            <path d="M 48 36 L 48 24 M 48 36 L 36 36" />
          </g>

          <g
            transform={`rotate(${-telemetry.rollDeg}) translate(0, ${Math.max(
              -55,
              Math.min(55, telemetry.pitchDeg * 1.15)
            )})`}
            stroke={modeAccent}
            strokeWidth="1.1"
            opacity="0.6"
          >
            <line x1="-95" y1="0" x2="-26" y2="0" />
            <line x1="26" y1="0" x2="95" y2="0" />
            <line x1="-45" y1="-22" x2="-22" y2="-22" strokeDasharray="4 3" />
            <line x1="22" y1="-22" x2="45" y2="-22" strokeDasharray="4 3" />
            <line x1="-45" y1="22" x2="-22" y2="22" strokeDasharray="4 3" />
            <line x1="22" y1="22" x2="45" y2="22" strokeDasharray="4 3" />
          </g>

          <g stroke={crosshairStroke} strokeWidth="1.6" fill="none">
            <circle cx="0" cy="0" r="6" />
            <line x1="-18" y1="0" x2="-7" y2="0" />
            <line x1="7" y1="0" x2="18" y2="0" />
            <line x1="0" y1="-15" x2="0" y2="-7" />
            <line x1="0" y1="7" x2="0" y2="15" />
          </g>

        </svg>
      </div>

      {/* Пассивная подсказка по цели у перекрестия и расчётное время до контакта. Автонаведения нет. */}
      <div className="fixed left-1/2 top-[61%] -translate-x-1/2 text-center">
        {telemetry.centerTargetName && (
          <div className="bg-amber-950/90 border border-amber-400/85 px-2.5 py-0.5 text-[10px] sm:text-xs font-bold tracking-wider text-amber-100">
            ◇ В ПЕРЕКРЕСТИИ: {telemetry.centerTargetName} ({telemetry.centerTargetDist} М
            {telemetry.timeToImpactSec !== null ? ` · ДО КОНТАКТА ${telemetry.timeToImpactSec}С` : ''})
          </div>
        )}
      </div>

      {/* === БОКОВЫЕ ШКАЛЫ СКОРОСТИ (СЛЕВА) И РАДИОВЫСОТОМЕРА (СПРАВА) === */}
      <div className="fixed left-2.5 top-[38%] flex flex-col gap-1.5 bg-black/70 px-2 py-1.5 border-l-2 border-emerald-400/75">
        <div className="text-[9px] opacity-65">СКОРОСТЬ</div>
        <div className="text-sm sm:text-base font-bold leading-none">
          {telemetry.speedKmh} <span className="text-[9px] font-normal">КМ/Ч</span>
        </div>
        <div
          className={`text-[9px] font-bold ${
            telemetry.throttle === 'boost'
              ? 'text-amber-300'
              : telemetry.throttle === 'brake'
              ? 'text-sky-300'
              : 'opacity-75'
          }`}
        >
          {telemetry.throttle === 'boost'
            ? '▲ ФОРСАЖ'
            : telemetry.throttle === 'brake'
            ? '▼ МАЛ. ГАЗ'
            : '● КРЕЙСЕР'}
        </div>
        <div className="mt-0.5 border-t border-white/15 pt-1 text-[9px]">
          <span className="opacity-65">ПЛАНЕР: </span>
          <span className={telemetry.hullIntegrity < 50 ? 'text-red-400 font-bold' : ''}>
            {telemetry.hullIntegrity}%
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[8px] opacity-60">РУЛИ</span>
          <span className="relative block h-7 w-7 border border-emerald-300/35 bg-emerald-950/35">
            <span className="absolute left-1/2 top-0 h-full w-px bg-emerald-300/20" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-emerald-300/20" />
            <span
              className="absolute h-1.5 w-1.5 rounded-full bg-amber-300"
              style={{
                left: `calc(50% + ${telemetry.controlYaw * 10}px)`,
                top: `calc(50% + ${-telemetry.controlPitch * 10}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          </span>
        </div>
      </div>

      <div
        className={`fixed right-2.5 top-[38%] flex flex-col items-end gap-1.5 px-2 py-1.5 border-r-2 transition-all ${
          highlightAlt
            ? 'bg-amber-950/85 border-amber-300 animate-pulse shadow-[0_0_16px_rgba(245,158,11,0.6)]'
            : 'bg-black/70 border-emerald-400/75'
        }`}
      >
        <div className="text-[9px] opacity-65">ВЫСОТА РВ</div>
        <div
          className={`text-sm sm:text-base font-bold leading-none ${
            telemetry.aglM < 30 ? 'text-amber-300' : ''
          }`}
        >
          {telemetry.aglM} <span className="text-[9px] font-normal">М</span>
        </div>
        <div className="text-[9px] opacity-75">ТАНГАЖ {telemetry.pitchDeg}°</div>
        <div className="mt-0.5 border-t border-white/15 pt-1 text-[9px] opacity-80">
          ТОПЛ: {telemetry.fuelPercent}%
        </div>
      </div>
    </div>
  );
}

interface ReconOverlayProps {
  report: ImpactReport;
  radioHitLine?: RadioLine;
  stats: {
    primaryTotal: number;
    primaryDestroyed: number;
    secondaryDestroyed: number;
    dronesRemaining: number;
    allPrimaryDone: boolean;
  };
  cameraMode: CameraMode;
  selectedWarhead: WarheadType;
  onSelectWarhead: (wh: WarheadType) => void;
  onOpenReplay: () => void;
  onNextAction: () => void;
  onCycleCamera: () => void;
}

/** Оверлей камеры высотного БПЛА-разведчика «ОРЛАН-30» после детонации «Герани» */
export function ReconOverlay({
  report,
  radioHitLine,
  stats,
  cameraMode,
  selectedWarhead,
  onSelectWarhead,
  onOpenReplay,
  onNextAction,
  onCycleCamera,
}: ReconOverlayProps) {
  const isSuccess =
    report.outcome === 'direct_hit' || report.outcome === 'splash_hit' || report.outcome === 'window_hit';
  const canLaunchNext = stats.dronesRemaining > 0 && !stats.allPrimaryDone;

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-5 font-mono text-emerald-200 select-none pointer-events-none">
      <div
        className="fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at center, transparent 48%, rgba(0, 8, 12, 0.7) 100%)',
        }}
      />

      {/* Верхняя шапка БПЛА-разведчика + радиоподтверждение попадания */}
      <div className="relative z-10 flex flex-col gap-2">
        <div className="flex items-center justify-between bg-black/80 border border-emerald-400/35 px-3 py-2">
          <div className="flex items-center gap-2.5 text-[11px] sm:text-xs">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold tracking-wider text-emerald-300">
              ОБЪЕКТИВНЫЙ КОНТРОЛЬ // БПЛА «ОРЛАН-30» (ВЫС. 2150 М)
            </span>
          </div>
          <button
            type="button"
            onClick={onCycleCamera}
            className="pointer-events-auto bg-emerald-950/85 border border-emerald-400/45 px-2.5 py-1 text-[10px] font-bold hover:bg-emerald-900"
          >
            КАМЕРА: {cameraMode.toUpperCase()}
          </button>
        </div>

        {isSuccess && radioHitLine && (
          <div className="mx-auto max-w-md border-l-4 border-emerald-400 bg-emerald-950/85 px-3 py-2 text-xs text-white shadow-lg">
            <div className="text-[9px] tracking-widest text-emerald-300 font-bold">
              РАДИОЭФИР // {radioHitLine.speaker}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug">«{radioHitLine.text}»</div>
          </div>
        )}
      </div>

      {/* Центральный прицельный крест разведчика */}
      <div className="relative z-10 flex items-center justify-center opacity-55">
        <div className="h-20 w-20 border border-dashed border-emerald-300/70 flex items-center justify-center">
          <div className="h-2 w-2 border border-emerald-300" />
        </div>
      </div>

      {/* Нижняя карточка подтверждения поражения, 3D-ПОВТОРА и оснащения следующего борта */}
      <div className="relative z-10 mx-auto w-full max-w-xl bg-black/85 border border-emerald-400/45 p-3.5 sm:p-4 backdrop-blur-md pointer-events-auto flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between text-[10px] tracking-widest opacity-75 mb-1">
            <span>ОТЧЁТ ПОРАЖЕНИЯ ЦЕЛИ</span>
            <span>
              ОСНОВНЫЕ ЦЕЛИ: {stats.primaryDestroyed} / {stats.primaryTotal}
            </span>
          </div>

          <h3
            className={`text-sm sm:text-base font-bold tracking-wider ${
              isSuccess ? 'text-emerald-300' : 'text-amber-400'
            }`}
          >
            {report.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">{report.subtitle}</p>
        </div>

        {/* Быстрый выбор БЧ для следующего борта волны */}
        {canLaunchNext && (
          <div className="border-t border-emerald-400/20 pt-2.5">
            <div className="text-[9.5px] tracking-wider text-emerald-300/85 mb-1.5">
              ОСНАЩЕНИЕ СЛЕДУЮЩЕГО БОРТА (В РЕЗЕРВЕ {stats.dronesRemaining} БПЛА):
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              {(['of50', 'thermite', 'kometa'] as WarheadType[]).map((wh) => {
                const sp = WARHEAD_SPECS[wh];
                return (
                  <button
                    key={wh}
                    type="button"
                    onClick={() => onSelectWarhead(wh)}
                    className={`p-1.5 border text-left transition-all ${
                      selectedWarhead === wh
                        ? 'bg-emerald-500/25 border-emerald-300 text-white'
                        : 'bg-black/60 border-emerald-400/25 text-emerald-200/75'
                    }`}
                  >
                    <div className="font-bold">{sp.code}</div>
                    <div className="text-[8.5px] opacity-80 truncate">{sp.badge}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenReplay}
            className="bg-cyan-500/20 hover:bg-cyan-500/35 active:scale-95 border border-cyan-400 px-3.5 py-2.5 text-xs font-bold tracking-wider text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)]"
          >
            🎥 ПОВТОР УДАРА (4 КАМЕРЫ)
          </button>

          <button
            type="button"
            onClick={onNextAction}
            className="flex-1 sm:flex-initial bg-emerald-500/25 hover:bg-emerald-500/40 active:scale-95 border border-emerald-400 px-4 py-2.5 text-xs sm:text-sm font-bold tracking-wider text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.28)]"
          >
            {stats.allPrimaryDone
              ? 'ЗАВЕРШИТЬ ОПЕРАЦИЮ →'
              : canLaunchNext
              ? 'СЛЕДУЮЩИЙ БОРТ ВОЛНЫ →'
              : 'ИТОГИ ОПЕРАЦИИ →'}
          </button>
        </div>
      </div>
    </div>
  );
}
