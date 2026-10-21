import { WARHEAD_SPECS, type CameraMode, type ReplayCameraAngle, type ReplayStatus } from '../game/types';

interface ReplayPlayerOverlayProps {
  status: ReplayStatus;
  cameraMode: CameraMode;
  onSetAngle: (angle: ReplayCameraAngle) => void;
  onTogglePlay: () => void;
  onSetSpeed: (speed: 0.25 | 0.5 | 1) => void;
  onSeek: (timeSec: number) => void;
  onJumpDive: () => void;
  onRestartFull: () => void;
  onToggleTrail: () => void;
  onCycleCameraMode: () => void;
  onClose: () => void;
}

export function ReplayPlayerOverlay({
  status,
  cameraMode,
  onSetAngle,
  onTogglePlay,
  onSetSpeed,
  onSeek,
  onJumpDive,
  onRestartFull,
  onToggleTrail,
  onCycleCameraMode,
  onClose,
}: ReplayPlayerOverlayProps) {
  const timeToHit = status.impactTime - status.currentTime;
  const impactPercent = Math.min(100, Math.max(0, (status.impactTime / Math.max(0.1, status.totalDuration)) * 100));

  const modeNames: Record<CameraMode, string> = {
    flir: 'ТПВ БЕЛ',
    bhot: 'ТПВ ЧЁРН',
    eo: 'ТВ ЦВЕТ',
    synth: 'ВИЗОР ИИ',
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-between p-2.5 sm:p-4 font-mono text-emerald-100 select-none pointer-events-none">
      {/* Виньетка монитора видеоконтроля */}
      <div
        className="fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at center, transparent 58%, rgba(0, 6, 10, 0.55) 100%)',
        }}
      />

      {/* === ВЕРХНЯЯ ПАНЕЛЬ РЕКОРДЕРА ОБЪЕКТИВНОГО КОНТРОЛЯ === */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 bg-black/80 border border-cyan-400/45 px-3 py-2 backdrop-blur-sm pointer-events-auto">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
          <div>
            <div className="text-[10px] sm:text-xs font-bold tracking-wider text-cyan-300">
              ЧЁРНЫЙ ЯЩИК ОК // БОРТ {status.callsign} ({WARHEAD_SPECS[status.warhead].code})
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-300">
              {status.impactTriggered ? (
                <span className="text-red-400 font-bold">● ДЕТОНАЦИЯ БЧ!</span>
              ) : (
                <>
                  <span>СКОР: <b className="text-white">{status.speedKmh}</b> КМ/Ч</span>
                  <span>|</span>
                  <span>ВЫС: <b className="text-white">{status.aglM}</b> М</span>
                  <span>|</span>
                  <span className="text-amber-300 font-bold">
                    КОНТАКТ: -{Math.max(0, timeToHit).toFixed(1)}С
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleTrail}
            className={`px-2 py-1 text-[10px] font-bold border ${
              status.showTrail
                ? 'bg-cyan-500/25 border-cyan-300 text-cyan-100'
                : 'bg-black/60 border-slate-500/40 text-slate-300'
            }`}
          >
            ТРЕК: {status.showTrail ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
          <button
            type="button"
            onClick={onCycleCameraMode}
            className="px-2 py-1 text-[10px] font-bold border border-emerald-400/45 bg-emerald-950/70 text-emerald-200 hover:bg-emerald-900"
          >
            {modeNames[cameraMode]}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[10px] sm:text-xs font-bold border border-red-400/70 bg-red-950/80 text-red-100 hover:bg-red-900"
          >
            ✕ ЗАКРЫТЬ ПОВТОР
          </button>
        </div>
      </div>

      {/* Прицельная сетка в центре, если выбран ракурс ГСН БОРТА */}
      {status.angle === 'fpv' && !status.impactTriggered && (
        <div className="fixed inset-0 flex items-center justify-center opacity-75">
          <div className="h-14 w-14 border border-emerald-300/80 flex items-center justify-center relative">
            <div className="h-1.5 w-1.5 rounded-full bg-red-400" />
          </div>
        </div>
      )}

      {/* === НИЖНИЙ ПУЛЬТ УПРАВЛЕНИЯ КАМЕРАМИ, СЛОУ-МО И ТАЙМЛАЙНОМ === */}
      <div className="relative z-10 mx-auto w-full max-w-2xl bg-black/85 border border-cyan-400/40 p-3 backdrop-blur-md pointer-events-auto flex flex-col gap-2.5">
        {/* Переключатель 4 ракурсов 3D-камеры */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
          {(
            [
              { id: 'chase', label: '🎥 ЗА КРЫЛОМ (3D)' },
              { id: 'target_pov', label: '🎯 С ЗЕМЛИ У ЦЕЛИ' },
              { id: 'fpv', label: '⌖ ГСН БОРТА (FPV)' },
              { id: 'orlan', label: '🛰 ОРЛАН-30 (ВЫСОТА)' },
            ] as const
          ).map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => onSetAngle(cam.id)}
              className={`py-1.5 px-2 border font-bold tracking-wider transition-all ${
                status.angle === cam.id
                  ? 'bg-cyan-500/35 border-cyan-300 text-white shadow-[0_0_14px_rgba(34,211,238,0.35)]'
                  : 'bg-black/60 border-emerald-400/25 text-emerald-200/80 hover:bg-emerald-950/50'
              }`}
            >
              {cam.label}
            </button>
          ))}
        </div>

        {/* Шкала времени с красным маркером момента удара */}
        <div className="relative flex items-center gap-2.5">
          <span className="text-[10px] w-11 text-right tabular-nums text-cyan-200">
            {status.currentTime.toFixed(1)}с
          </span>
          <div className="relative flex-1 flex items-center">
            <div
              title="Момент детонации БЧ"
              style={{ left: `${impactPercent}%` }}
              className="pointer-events-none absolute -top-1.5 bottom-[-6px] w-[2px] bg-red-500 z-10"
            />
            <input
              type="range"
              min={0}
              max={status.totalDuration}
              step={0.02}
              value={status.currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>
          <span className="text-[10px] w-11 tabular-nums text-slate-400">
            {status.totalDuration.toFixed(1)}с
          </span>
        </div>

        {/* Управление воспроизведением и замедлением времени (Слоу-мо) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onTogglePlay}
              className="px-3 py-1.5 border border-emerald-400 bg-emerald-500/25 font-bold text-white hover:bg-emerald-500/40"
            >
              {status.playing ? '⏸ ПАУЗА' : '▶ ПУСК'}
            </button>
            <button
              type="button"
              onClick={onJumpDive}
              className="px-2.5 py-1.5 border border-amber-400/50 bg-amber-950/50 font-bold text-amber-200 hover:bg-amber-900/60"
            >
              ⟲ УДАР (-8С)
            </button>
            <button
              type="button"
              onClick={onRestartFull}
              className="px-2 py-1.5 border border-emerald-400/30 bg-black/60 text-emerald-200/80 hover:bg-slate-900"
            >
              С НАЧАЛА
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="opacity-65 mr-1 hidden sm:inline">СКОРОСТЬ:</span>
            {([1, 0.5, 0.25] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onSetSpeed(spd)}
                className={`px-2 py-1.5 border font-bold ${
                  status.speed === spd
                    ? 'bg-amber-500/35 border-amber-300 text-white'
                    : 'bg-black/60 border-emerald-400/25 text-emerald-200/75'
                }`}
              >
                {spd === 0.25 ? '0.25× СЛОУ-МО' : `${spd.toFixed(1)}×`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
