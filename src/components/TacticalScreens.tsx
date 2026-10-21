import { useState } from 'react';
import { CAMPAIGN_PROLOGUE, OPERATOR_RANKS } from '../game/missions';
import {
  WARHEAD_SPECS,
  type CameraMode,
  type ControlSettings,
  type FreeHuntConfig,
  type MissionDef,
  type SortieReplayRecord,
  type WarheadType,
} from '../game/types';

function getOperatorRank(completedIds: number[]) {
  const count = completedIds.filter((id) => id >= 1).length;
  let current = OPERATOR_RANKS[0];
  for (const r of OPERATOR_RANKS) {
    if (count >= r.minCleared) current = r;
  }
  return { ...current, combatCleared: count };
}

interface MainMenuProps {
  missions: MissionDef[];
  completedIds: number[];
  settings: ControlSettings;
  defaultCamera: CameraMode;
  onSelectMission: (idx: number) => void;
  onStartFreeHunt: (cfg: FreeHuntConfig) => void;
  onOpenManual: () => void;
  onUpdateSettings: (next: ControlSettings) => void;
  onChangeDefaultCamera: (mode: CameraMode) => void;
}

export function MainMenuScreen({
  missions,
  completedIds,
  settings,
  defaultCamera,
  onSelectMission,
  onStartFreeHunt,
  onOpenManual,
  onUpdateSettings,
  onChangeDefaultCamera,
}: MainMenuProps) {
  const rankInfo = getOperatorRank(completedIds);
  const tutorialDone = completedIds.includes(0);

  const [huntOpen, setHuntOpen] = useState(false);
  const [huntScenario, setHuntScenario] = useState<FreeHuntConfig['scenario']>('convoy');
  const [huntTime, setHuntTime] = useState<FreeHuntConfig['timeOfDay']>('dusk');
  const [huntIntensity, setHuntIntensity] = useState<FreeHuntConfig['intensity']>('normal');

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#050a0c] text-emerald-100 font-mono select-none">
      {/* Электронная координатная сетка на фоне */}
      <div
        className="pointer-events-none fixed inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,255,190,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,190,0.16) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      <div className="relative z-10 mx-auto max-w-2xl px-4 py-5 sm:py-8 flex flex-col gap-4">
        {/* Главный терминал ПБУ «Сумрак» */}
        <div className="border border-emerald-400/40 bg-black/80 p-4 sm:p-5 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-[9.5px] tracking-[0.22em] text-emerald-400 font-bold">
                ★ {CAMPAIGN_PROLOGUE.factionName}
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_20px_rgba(16,185,129,0.35)]">
                ГЕРАНЬ-2М: УДАРНЫЙ РОЙ
              </h1>
              <p className="mt-1.5 text-xs text-slate-300/90 leading-relaxed">
                {CAMPAIGN_PROLOGUE.summary}
              </p>
            </div>

            {/* Точный чертеж дельта-планера «Герань-2М» */}
            <div className="shrink-0 self-center border border-emerald-400/25 bg-emerald-950/20 p-2.5">
              <svg width="108" height="86" viewBox="0 0 120 96" className="text-emerald-300">
                <line x1="60" y1="4" x2="60" y2="92" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />
                <line x1="8" y1="54" x2="112" y2="54" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />
                <path
                  d="M 60 8 L 65 26 L 106 72 L 106 80 L 66 76 L 64 84 L 56 84 L 54 76 L 14 80 L 14 72 L 55 26 Z"
                  fill="rgba(16,185,129,0.14)"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <circle cx="60" cy="14" r="3" fill="#ff3b5c" />
                <rect x="56.5" y="25" width="7" height="16" fill="none" stroke="#ffaa22" strokeWidth="1.2" />
                <line x1="47" y1="87" x2="73" y2="87" stroke="#ffffff" strokeWidth="2" />
                <line x1="14" y1="68" x2="14" y2="83" stroke="currentColor" strokeWidth="2.5" />
                <line x1="106" y1="68" x2="106" y2="83" stroke="currentColor" strokeWidth="2.5" />
              </svg>
              <div className="text-center text-[9px] tracking-widest text-emerald-400/75">
                ОФБЧ-50 · ТЕРМИТ · КОМЕТА
              </div>
            </div>
          </div>

          {/* Личное дело оператора «КЕДР» + Кнопки Полигона, Свободной охоты и Боевого устава */}
          <div className="mt-3.5 border border-emerald-400/25 bg-emerald-950/25 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span className="text-[10px] text-emerald-400/80">ОПЕРАТОР {CAMPAIGN_PROLOGUE.operatorCallsign}: </span>
              <span className="font-bold text-white">{rankInfo.rank.toUpperCase()}</span>
              <span className="text-[11px] text-emerald-300/80"> // {rankInfo.badge}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectMission(0)}
                className={`px-2.5 py-1 border text-[10px] font-bold tracking-wider ${
                  !tutorialDone
                    ? 'bg-amber-500/30 border-amber-300 text-amber-100 animate-pulse'
                    : 'bg-emerald-950/70 border-emerald-400/40 text-emerald-200'
                }`}
              >
                ★ ОБУЧЕНИЕ
              </button>
              <button
                type="button"
                onClick={() => setHuntOpen((v) => !v)}
                className={`px-2.5 py-1 border text-[10px] font-bold tracking-wider ${
                  huntOpen
                    ? 'bg-red-500/30 border-red-400 text-white'
                    : 'bg-red-950/55 border-red-400/50 text-red-200 hover:bg-red-900/60'
                }`}
              >
                ⚔ СВОБОДНАЯ ОХОТА
              </button>
              <button
                type="button"
                onClick={onOpenManual}
                className="px-2.5 py-1 border border-cyan-400/50 bg-cyan-950/50 text-[10px] font-bold tracking-wider text-cyan-200 hover:bg-cyan-900/60"
              >
                ? БОЕВОЙ УСТАВ
              </button>
            </div>
          </div>

          {/* Раскрываемый генератор боевых вылетов «СВОБОДНАЯ ОХОТА» */}
          {huntOpen && (
            <div className="mt-3 border border-red-400/45 bg-red-950/20 p-3 flex flex-col gap-2.5">
              <div className="text-[10.5px] font-bold tracking-wider text-red-300">
                ⚔ КОНСТРУКТОР ВЫЛЕТА «СВОБОДНАЯ ОХОТА» (СЛУЧАЙНАЯ ГЕНЕРАЦИЯ ТВД):
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px]">
                {(
                  [
                    { id: 'convoy', label: 'ТАНКОВАЯ КОЛОННА' },
                    { id: 'airdefense', label: 'УЗЕЛ ПВО И РЭБ' },
                    { id: 'oildepot', label: 'НЕФТЕБАЗА ТЫЛА' },
                    { id: 'airbase', label: 'АВИАБАЗА ВРАГА' },
                    { id: 'window_hq', label: '▦ В ОКНО ШТАБА' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setHuntScenario(s.id)}
                    className={`py-1.5 px-2 border font-bold ${
                      huntScenario === s.id
                        ? 'bg-red-500/35 border-red-300 text-white'
                        : 'bg-black/60 border-emerald-400/25 text-slate-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                <div className="flex items-center gap-1">
                  <span className="opacity-70">ВРЕМЯ:</span>
                  {(
                    [
                      { id: 'dawn', label: 'РАССВЕТ' },
                      { id: 'day', label: 'ДЕНЬ' },
                      { id: 'dusk', label: 'ЗАКАТ' },
                      { id: 'night', label: 'НОЧЬ' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setHuntTime(t.id)}
                      className={`px-2 py-1 border font-bold ${
                        huntTime === t.id
                          ? 'bg-amber-500/35 border-amber-300 text-white'
                          : 'bg-black/60 border-emerald-400/25 text-slate-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setHuntIntensity((p) => (p === 'normal' ? 'hardcore' : 'normal'))
                    }
                    className={`px-2 py-1 border font-bold ${
                      huntIntensity === 'hardcore'
                        ? 'bg-red-600/40 border-red-300 text-white'
                        : 'bg-black/60 border-emerald-400/30 text-emerald-200'
                    }`}
                  >
                    ПВО: {huntIntensity === 'hardcore' ? 'ШТОРМ (ЗРК+РЭБ)' : 'ШТАТНАЯ'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onStartFreeHunt({
                        scenario: huntScenario,
                        timeOfDay: huntTime,
                        intensity: huntIntensity,
                      })
                    }
                    className="px-3 py-1 bg-emerald-500/35 hover:bg-emerald-500/50 border border-emerald-300 font-bold text-white"
                  >
                    В БОЙ →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Настройки стартовой камеры, HDR графики, звука и оси тангажа */}
          <div className="mt-3 pt-3 border-t border-emerald-400/20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="opacity-65 text-[10px]">КАМЕРА:</span>
              {(['flir', 'bhot', 'eo', 'synth'] as CameraMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeDefaultCamera(m)}
                  className={`px-2 py-1 border text-[10px] font-bold ${
                    defaultCamera === m
                      ? 'bg-emerald-500/30 border-emerald-300 text-white'
                      : 'bg-black/60 border-emerald-400/25 text-emerald-300/70'
                  }`}
                >
                  {m === 'flir'
                    ? 'ТПВ БЕЛ'
                    : m === 'bhot'
                    ? 'ТПВ ЧЁРН'
                    : m === 'eo'
                    ? 'ТВ ОПТИКА'
                    : 'ВИЗОР ИИ'}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, highGraphics: !settings.highGraphics })
                }
                className={`px-2 py-1 border text-[10px] font-bold ${
                  settings.highGraphics
                    ? 'border-emerald-400/50 bg-emerald-950/50 text-emerald-200'
                    : 'border-slate-500/40 bg-black/60 text-slate-300'
                }`}
              >
                ГРАФИКА: {settings.highGraphics ? 'ФОТОРЕАЛИЗМ' : 'СКОРОСТЬ'}
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, invertPitch: !settings.invertPitch })
                }
                className="px-2 py-1 border border-emerald-400/30 bg-black/60 text-[10px]"
              >
                ОСЬ Y: {settings.invertPitch ? 'АВИА' : 'ПРЯМАЯ'}
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled })
                }
                className={`px-2 py-1 border text-[10px] font-bold ${
                  settings.soundEnabled
                    ? 'border-emerald-400/50 bg-emerald-950/50 text-emerald-200'
                    : 'border-red-400/40 bg-red-950/40 text-red-300'
                }`}
              >
                ЗВУК: {settings.soundEnabled ? 'ВКЛ' : 'ВЫКЛ'}
              </button>
            </div>
          </div>
        </div>

        {/* Журнал боевых операций против корпуса «Чёрный Клин» */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs font-bold tracking-[0.2em] text-emerald-400/85 px-1">
            <span>СЮЖЕТНАЯ КАМПАНИЯ РУ-ВОЙСК:</span>
            <span className="text-[10px] text-amber-300/85">
              ВРАГ: {CAMPAIGN_PROLOGUE.enemyName}
            </span>
          </div>

          {missions.map((m, idx) => {
            const done = completedIds.includes(m.id);
            const primaries = m.targets.filter((t) => t.isPrimary).length;
            const highlightCard = m.isTutorial && !tutorialDone;

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectMission(idx)}
                className={`group w-full text-left border p-3.5 sm:p-4 transition-all ${
                  highlightCard
                    ? 'border-amber-400/80 bg-amber-950/20 hover:bg-amber-950/35 shadow-[0_0_20px_rgba(245,158,11,0.18)]'
                    : 'border-emerald-400/30 hover:border-emerald-300 bg-black/75 hover:bg-emerald-950/35'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-widest">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 font-bold ${
                        m.isTutorial
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                      }`}
                    >
                      {m.chapterLabel}
                    </span>
                    <span className="text-emerald-400/80 font-bold">{m.code}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                      ЦЕЛЕЙ: {primaries} · ВОЛНА: {m.dronesCount} БПЛА
                    </span>
                    {done && (
                      <span className="bg-emerald-500/25 border border-emerald-400 px-1.5 py-0.5 text-emerald-200 font-bold">
                        ✓ ВЫПОЛНЕНО
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex items-baseline justify-between">
                  <h2 className="text-base sm:text-lg font-bold tracking-wider text-white group-hover:text-emerald-200">
                    {m.title}
                  </h2>
                  <span className="text-[10px] text-amber-300/80 hidden sm:inline">
                    {m.weatherLabel}
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-300/85 line-clamp-2">{m.storyLead}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BriefingScreenProps {
  mission: MissionDef;
  selectedWarhead: WarheadType;
  onSelectWarhead: (wh: WarheadType) => void;
  onStartSortie: () => void;
  onOpenManual: () => void;
  onBack: () => void;
}

/** Тактический планшет предполетного брифинга с выбором БЧ / модификации БПЛА */
export function BriefingScreen({
  mission,
  selectedWarhead,
  onSelectWarhead,
  onStartSortie,
  onOpenManual,
  onBack,
}: BriefingScreenProps) {
  const mapPoint = (x: number, z: number) => ({
    cx: 130 + (x / 360) * 105,
    cy: 130 + ((z + 180) / 1450) * 105,
  });

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#050a0c] text-emerald-100 font-mono select-none p-4 sm:p-6">
      <div className="mx-auto max-w-3xl border border-emerald-400/40 bg-black/85 p-4 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-emerald-400/25 pb-3">
          <div>
            <div className="text-[10px] tracking-[0.28em] text-emerald-400 font-bold">
              {mission.chapterLabel} // {mission.code}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-wider text-white mt-0.5">
              {mission.title}
            </h2>
            <div className="text-[11px] text-amber-300/85 mt-0.5">{mission.weatherLabel}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenManual}
              className="border border-cyan-400/40 bg-cyan-950/40 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/50"
            >
              ? УСТАВ
            </button>
            <button
              type="button"
              onClick={onBack}
              className="border border-emerald-400/35 px-3 py-1.5 text-xs hover:bg-emerald-950/60"
            >
              ← В ШТАБ
            </button>
          </div>
        </div>

        {/* Художественная сводка с участка фронта */}
        <div className="border-l-4 border-emerald-400 bg-emerald-950/25 px-3.5 py-2.5 text-xs text-emerald-100/95 leading-relaxed">
          <div className="text-[9.5px] font-bold tracking-widest text-emerald-400 mb-0.5">
            ОПЕРАТИВНАЯ СВОДКА ШТАБА РУ-ВОЙСК:
          </div>
          {mission.storyLead}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          {/* Электронная карта разведки целей */}
          <div className="border border-emerald-400/30 bg-[#041014] p-3 flex flex-col items-center">
            <div className="w-full flex justify-between text-[9px] text-emerald-400/75 mb-1.5">
              <span>КАРТА АЭРОФОТОРАЗВЕДКИ</span>
              <span>{mission.sector}</span>
            </div>
            <svg viewBox="0 0 260 260" className="w-full max-w-[260px] aspect-square border border-emerald-400/20">
              {[52, 104, 156, 208].map((g) => (
                <g key={g} stroke="rgba(0,255,200,0.12)" strokeWidth="1">
                  <line x1={g} y1="0" x2={g} y2="260" />
                  <line x1="0" y1={g} x2="260" y2={g} />
                </g>
              ))}
              <line x1="130" y1="0" x2="130" y2="260" stroke="rgba(160,180,175,0.28)" strokeWidth="4" />
              {mission.riverZ !== undefined && (
                <line
                  x1="0"
                  y1={mapPoint(0, mission.riverZ).cy}
                  x2="260"
                  y2={mapPoint(0, mission.riverZ).cy}
                  stroke="rgba(40,150,220,0.45)"
                  strokeWidth="7"
                />
              )}
              <line
                x1="130"
                y1="242"
                x2="130"
                y2="135"
                stroke="#00ffc8"
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
              <polygon points="130,236 125,248 135,248" fill="#00ffc8" />

              {mission.trainingGates?.map((g) => {
                const p = mapPoint(g.x, g.z);
                return (
                  <circle
                    key={g.id}
                    cx={p.cx}
                    cy={Math.min(245, Math.max(15, p.cy))}
                    r="5"
                    fill="none"
                    stroke="#00ffc8"
                    strokeWidth="1.5"
                  />
                );
              })}

              {mission.targets.map((t) => {
                const p = mapPoint(t.x, t.z);
                return (
                  <g key={t.id}>
                    {t.ewRadius && (
                      <circle
                        cx={p.cx}
                        cy={p.cy}
                        r={(t.ewRadius / 1450) * 105}
                        fill="rgba(255,170,34,0.08)"
                        stroke="rgba(255,170,34,0.45)"
                        strokeDasharray="3 3"
                      />
                    )}
                    <rect
                      x={p.cx - 4}
                      y={p.cy - 4}
                      width="8"
                      height="8"
                      fill={t.isPrimary ? '#ff2a4d' : '#ffaa22'}
                    />
                    <text
                      x={p.cx + 7}
                      y={p.cy + 3}
                      fontSize="7.5"
                      fill={t.isPrimary ? '#ffd6de' : '#ffe2ad'}
                    >
                      {t.codeName}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Боевой приказ и список объектов поражения */}
          <div className="flex flex-col gap-3">
            <div className="space-y-2 text-xs text-slate-200 leading-relaxed">
              {mission.briefing.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            <div className="border border-emerald-400/25 bg-emerald-950/20 p-2.5">
              <div className="text-[10px] font-bold tracking-wider text-emerald-300 mb-1.5">
                НАЗНАЧЕННЫЕ ЦЕЛИ ДЛЯ ПОРАЖЕНИЯ:
              </div>
              <div className="space-y-1 text-[11px]">
                {mission.targets
                  .filter((t) => t.isPrimary)
                  .map((t) => (
                    <div key={t.id} className="flex items-center justify-between">
                      <span className="text-red-300 font-bold">◆ {t.codeName}</span>
                      <span className="text-slate-200">{t.name}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="border-l-2 border-amber-400 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200">
              <strong>СОВЕТ КОМАНДИРА «ГРАНИТ»:</strong> {mission.tacticalTip}
            </div>
          </div>
        </div>

        {/* === ВЫБОР БОЕВОЙ ЧАСТИ / МОДИФИКАЦИИ БПЛА ПЕРЕД ПУСКОМ === */}
        <div className="border border-emerald-400/35 bg-black/70 p-3">
          <div className="text-[10px] font-bold tracking-[0.2em] text-emerald-300 mb-2">
            ВЫБЕРИТЕ БОЕВУЮ ЧАСТЬ И МОДИФИКАЦИЮ 1-ГО БОРТА «ГЕРАНЬ-2М»:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['of50', 'thermite', 'kometa'] as WarheadType[]).map((wh) => {
              const sp = WARHEAD_SPECS[wh];
              const active = selectedWarhead === wh;
              return (
                <button
                  key={wh}
                  type="button"
                  onClick={() => onSelectWarhead(wh)}
                  className={`p-2.5 border text-left transition-all ${
                    active
                      ? 'bg-emerald-500/25 border-emerald-300 text-white shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                      : 'bg-black/60 border-emerald-400/20 text-slate-300 hover:border-emerald-400/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-emerald-200">{sp.name}</span>
                  </div>
                  <div className="text-[9px] text-amber-300 mt-0.5">{sp.badge}</div>
                  <p className="mt-1 text-[10px] text-slate-300/90 leading-snug">
                    {sp.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onStartSortie}
          className="w-full py-3.5 bg-emerald-500/25 hover:bg-emerald-500/40 active:scale-[0.99] border-2 border-emerald-400 text-sm sm:text-base font-bold tracking-[0.2em] text-white shadow-[0_0_25px_rgba(16,185,129,0.3)]"
        >
          ЗАПУСТИТЬ КАТАПУЛЬТУ — В БОЙ ({WARHEAD_SPECS[selectedWarhead].code}) →
        </button>
      </div>
    </div>
  );
}

interface DebriefScreenProps {
  mission: MissionDef;
  completedIds: number[];
  replays: SortieReplayRecord[];
  stats: {
    primaryTotal: number;
    primaryDestroyed: number;
    secondaryDestroyed: number;
    dronesRemaining: number;
    allPrimaryDone: boolean;
  };
  hasNextMission: boolean;
  onWatchReplay: (replayIndex: number) => void;
  onRetry: () => void;
  onNextMission: () => void;
  onMenu: () => void;
}

export function DebriefScreen({
  mission,
  completedIds,
  replays,
  stats,
  hasNextMission,
  onWatchReplay,
  onRetry,
  onNextMission,
  onMenu,
}: DebriefScreenProps) {
  const victory = stats.allPrimaryDone;
  const usedDrones = mission.dronesCount - stats.dronesRemaining;
  const rankInfo = getOperatorRank(completedIds);

  return (
    <div className="fixed inset-0 overflow-y-auto flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-emerald-100 select-none z-40">
      <div className="w-full max-w-lg border border-emerald-400/50 bg-[#060d10]/95 p-5 sm:p-6 flex flex-col gap-3.5 shadow-2xl my-auto">
        <div className="flex items-center justify-between text-[10px] tracking-[0.25em] opacity-75">
          <span>{mission.chapterLabel}</span>
          <span>{mission.code}</span>
        </div>

        <h2
          className={`text-xl sm:text-2xl font-bold tracking-wider ${
            victory ? 'text-emerald-300' : 'text-amber-400'
          }`}
        >
          {victory ? '★ БОЕВАЯ ЗАДАЧА ВЫПОЛНЕНА' : '✕ ВОЛНА БПЛА ИЗРАСХОДОВАНА'}
        </h2>

        <div
          className={`border-l-4 px-3.5 py-2.5 text-xs leading-relaxed ${
            victory
              ? 'border-emerald-400 bg-emerald-950/35 text-emerald-100'
              : 'border-amber-400 bg-amber-950/30 text-slate-200'
          }`}
        >
          {victory
            ? mission.radioVictory
            : 'КП «Гранит»: Часть объектов «фашиков» уцелела после прохода ударной волны. Пополняем боекомплект пусковых установок — скорректируйте высоту подхода и повторите залп!'}
        </div>

        <div className="border border-emerald-400/25 bg-black/60 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="opacity-75">ОСНОВНЫЕ ЦЕЛИ ПОРАЖЕНЫ:</span>
            <span className="font-bold text-white">
              {stats.primaryDestroyed} / {stats.primaryTotal}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-75">ПОДАВЛЕНО ТОЧЕК ПВО/РЭБ:</span>
            <span className="font-bold text-white">{stats.secondaryDestroyed}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-75">ИЗРАСХОДОВАНО БПЛА «ГЕРАНЬ-2М»:</span>
            <span className="font-bold text-emerald-300">
              {usedDrones} ИЗ {mission.dronesCount}
            </span>
          </div>
          <div className="flex justify-between border-t border-emerald-400/15 pt-1.5">
            <span className="opacity-75">ТЕКУЩЕЕ ЗВАНИЕ ОПЕРАТОРА:</span>
            <span className="font-bold text-amber-300">{rankInfo.rank.toUpperCase()}</span>
          </div>
        </div>

        {/* Архив 3D-повторов всех бортов прошедшей операции */}
        {replays.length > 0 && (
          <div className="border border-cyan-400/35 bg-cyan-950/15 p-3">
            <div className="text-[10px] font-bold tracking-wider text-cyan-300 mb-1.5">
              🎥 ЗАПИСИ «ЧЁРНОГО ЯЩИКА» (НАЖМИТЕ ДЛЯ 3D-ПОВТОРА):
            </div>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
              {replays.map((r) => (
                <button
                  key={r.index}
                  type="button"
                  onClick={() => onWatchReplay(r.index)}
                  className="flex items-center justify-between bg-black/70 hover:bg-cyan-950/60 border border-cyan-400/30 px-2.5 py-1.5 text-[10.5px] text-left"
                >
                  <span className="truncate pr-2 text-slate-200">{r.summaryLabel}</span>
                  <span className="shrink-0 font-bold text-cyan-300">▶ ПОВТОР</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {victory && hasNextMission && (
            <button
              type="button"
              onClick={onNextMission}
              className="py-3 bg-emerald-500/30 hover:bg-emerald-500/45 border-2 border-emerald-300 text-sm font-bold tracking-wider text-white shadow-[0_0_20px_rgba(16,185,129,0.28)]"
            >
              СЛЕДУЮЩАЯ ГЛАВА КАМПАНИИ →
            </button>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="py-2.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-xs font-bold tracking-wider text-amber-200"
          >
            ПОВТОРИТЬ ОПЕРАЦИЮ
          </button>
          <button
            type="button"
            onClick={onMenu}
            className="py-2.5 bg-black/60 hover:bg-slate-900 border border-emerald-400/30 text-xs tracking-wider text-emerald-200"
          >
            ВЕРНУТЬСЯ В ШТАБ (МЕНЮ)
          </button>
        </div>
      </div>
    </div>
  );
}
