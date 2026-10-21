import { useCallback, useEffect, useRef, useState } from 'react';
import { generateFreeHuntMission, MISSIONS } from './game/missions';
import { GeranSimulation } from './game/sim3d';
import { soundFX } from './game/sound';
import type {
  CameraMode,
  ControlSettings,
  FlightInput,
  FreeHuntConfig,
  GamePhase,
  ImpactReport,
  MissionDef,
  RadioLine,
  ReplayStatus,
  TelemetryData,
  TutorialStep,
  WarheadType,
} from './game/types';
import { DroneHUD, ReconOverlay } from './components/DroneHUD';
import { FieldManualModal } from './components/RadioAndTutorial';
import { ReplayPlayerOverlay } from './components/ReplayPlayerOverlay';
import { StaticNoiseCanvas } from './components/StaticNoiseCanvas';
import { TouchControls } from './components/TouchControls';
import {
  BriefingScreen,
  DebriefScreen,
  MainMenuScreen,
} from './components/TacticalScreens';

const INITIAL_TELEMETRY: TelemetryData = {
  callsign: 'Г-204',
  droneIndex: 1,
  totalDrones: 3,
  warhead: 'of50',
  speedKmh: 192,
  altitudeM: 320,
  aglM: 245,
  pitchDeg: -8,
  rollDeg: 0,
  headingDeg: 0,
  throttle: 'cruise',
  fuelPercent: 96,
  signalQuality: 98,
  ewInterference: 0,
  lowAltStealth: false,
  stealthCeilingM: 58,
  groundPullUpWarning: false,
  centerTargetName: null,
  centerTargetDist: null,
  timeToImpactSec: null,
  controlYaw: 0,
  controlPitch: 0,
  samWarning: false,
  samNearestDist: null,
  flakWarning: false,
  zoom: 1,
  cameraMode: 'flir',
  projectedTargets: [],
  radarBlips: [],
  flightTimeSec: 0,
  hullIntegrity: 100,
  gatesPassed: 0,
  gatesTotal: 0,
};

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [missionIdx, setMissionIdx] = useState(0);
  const [customMission, setCustomMission] = useState<MissionDef | null>(null);
  const [selectedWarhead, setSelectedWarhead] = useState<WarheadType>('of50');

  const [paused, setPaused] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const [cameraMode, setCameraMode] = useState<CameraMode>('flir');
  const [settings, setSettings] = useState<ControlSettings>({
    invertPitch: false,
    sensitivity: 1.0,
    soundEnabled: true,
    highGraphics: true,
  });

  const [completedIds, setCompletedIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem('geran2m_completed');
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  });

  const [telemetry, setTelemetry] = useState<TelemetryData>(INITIAL_TELEMETRY);
  const [impactReport, setImpactReport] = useState<ImpactReport | null>(null);
  const [linkBootFlash, setLinkBootFlash] = useState(false);

  // Состояние 3D-повтора («Чёрный ящик ОК»)
  const [replayStatus, setReplayStatus] = useState<ReplayStatus | null>(null);
  const [replayReturnPhase, setReplayReturnPhase] = useState<'recon' | 'debrief'>('recon');

  // Живой радиоэфир и пошаговый инструктор полигона
  const [radioMessage, setRadioMessage] = useState<RadioLine | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>('none');

  const mountRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<GeranSimulation | null>(null);
  const radioTimerRef = useRef<number | null>(null);
  const inputRef = useRef<FlightInput>({
    yawRoll: 0,
    pitch: 0,
    boost: false,
    airbrake: false,
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const pausedRef = useRef(paused);
  pausedRef.current = paused || manualOpen;

  const currentMission = customMission ?? MISSIONS[missionIdx];

  const pushRadioMessage = useCallback((line: RadioLine) => {
    soundFX.playRadioSquelch();
    setRadioMessage(line);
    if (radioTimerRef.current) {
      window.clearTimeout(radioTimerRef.current);
    }
    radioTimerRef.current = window.setTimeout(() => {
      setRadioMessage(null);
    }, 8500);
  }, []);

  const markCompleted = useCallback((id: number) => {
    setCompletedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem('geran2m_completed', JSON.stringify(next));
      } catch {
        // ignore storage quota
      }
      return next;
    });
  }, []);

  const disposeSim = useCallback(() => {
    simRef.current?.dispose();
    simRef.current = null;
  }, []);

  const advanceTutorialStep = useCallback(() => {
    soundFX.playUIClick();
    setTutorialStep((prev) => {
      if (prev === 'steer_gates') return 'switch_sensor';
      if (prev === 'switch_sensor') return 'low_altitude';
      if (prev === 'low_altitude') return 'manual_aim';
      if (prev === 'manual_aim') return 'boost_impact';
      return prev;
    });
  }, []);

  useEffect(() => {
    if (phase !== 'flying' || tutorialStep === 'none') return;

    if (tutorialStep === 'low_altitude' && telemetry.aglM < 60) {
      const t = window.setTimeout(() => {
        soundFX.playGatePass();
        setTutorialStep('manual_aim');
      }, 950);
      return () => window.clearTimeout(t);
    }

    if (
      tutorialStep === 'manual_aim' &&
      telemetry.centerTargetName &&
      telemetry.centerTargetDist !== null &&
      telemetry.centerTargetDist < 900
    ) {
      const t = window.setTimeout(() => {
        soundFX.playGatePass();
        setTutorialStep('boost_impact');
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [
    phase,
    tutorialStep,
    telemetry.aglM,
    telemetry.centerTargetName,
    telemetry.centerTargetDist,
  ]);

  /** Инициализация 3D ТВД и запуск первого борта «Герань-2М» */
  const startMissionObjSortie = useCallback(
    (mission: MissionDef, warheadToUse: WarheadType) => {
      soundFX.unlock();
      soundFX.playUIClick();
      disposeSim();
      inputRef.current = { yawRoll: 0, pitch: 0, boost: false, airbrake: false };

      setPaused(false);
      setImpactReport(null);
      setReplayStatus(null);
      setRadioMessage(null);
      setTutorialStep(mission.isTutorial ? 'steer_gates' : 'none');
      setPhase('flying');

      requestAnimationFrame(() => {
        const container = mountRef.current;
        if (!container) return;

        const sim = new GeranSimulation(
          container,
          mission,
          cameraMode,
          (report) => {
            setImpactReport(report);
            setPhase('static_cut');

            setTimeout(() => {
              soundFX.playDistantDetonation(report.secondaryDetonation);
              if (report.outcome === 'direct_hit' || report.outcome === 'splash_hit') {
                soundFX.playRadioSquelch();
              }
              const stats = sim.getStats();
              if (stats.allPrimaryDone && !mission.isGenerated) {
                markCompleted(mission.id);
              }
              setPhase('recon');
            }, 850);
          },
          (data) => {
            setTelemetry(data);
          },
          (line) => {
            pushRadioMessage(line);
          },
          (passed, total) => {
            if (passed >= total) {
              setTutorialStep('switch_sensor');
            }
          },
          (repStatus) => {
            setReplayStatus(repStatus);
          }
        );

        simRef.current = sim;
        sim.launchNextDrone(warheadToUse);
        setLinkBootFlash(true);
        setTimeout(() => setLinkBootFlash(false), 650);
      });
    },
    [cameraMode, disposeSim, markCompleted, pushRadioMessage]
  );

  const startCampaignMissionByIdx = useCallback(
    (idx: number) => {
      setCustomMission(null);
      setMissionIdx(idx);
      startMissionObjSortie(MISSIONS[idx], selectedWarhead);
    },
    [selectedWarhead, startMissionObjSortie]
  );

  // Главный цикл 60 FPS для 3D-мира и 3D-реплея
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (simRef.current && !pausedRef.current) {
        simRef.current.step(dt, inputRef.current, settingsRef.current);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => disposeSim(), [disposeSim]);

  const handleCycleCamera = useCallback(() => {
    soundFX.playUIClick();
    setCameraMode((prev) => {
      const order: CameraMode[] = ['flir', 'bhot', 'eo', 'synth'];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      simRef.current?.applyCameraMode(next);
      return next;
    });
    setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
  }, []);

  const handleToggleZoom = useCallback(() => {
    soundFX.playUIClick();
    if (!simRef.current) return;
    const nextZoom: 1 | 2.5 = telemetry.zoom === 1 ? 2.5 : 1;
    simRef.current.setZoom(nextZoom);
    setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
  }, [telemetry.zoom]);

  // Открытие и закрытие 3D-Повтора («Чёрного ящика»)
  const handleOpenReplay = useCallback(
    (fromPhase: 'recon' | 'debrief', replayIndex?: number) => {
      soundFX.playUIClick();
      const sim = simRef.current;
      if (!sim) return;
      if (sim.startReplay(replayIndex, true)) {
        setReplayReturnPhase(fromPhase);
        setPhase('replay');
      }
    },
    []
  );

  const handleCloseReplay = useCallback(() => {
    soundFX.playUIClick();
    simRef.current?.stopReplay();
    setPhase(replayReturnPhase);
  }, [replayReturnPhase]);

  // Горячие клавиши камеры, зума и управления реплеем
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();

      if (phase === 'replay') {
        if (k === 'escape') handleCloseReplay();
        else if (k === ' ') {
          e.preventDefault();
          simRef.current?.setReplayPlaying(!replayStatus?.playing);
        } else if (k === '1') simRef.current?.setReplayAngle('chase');
        else if (k === '2') simRef.current?.setReplayAngle('target_pov');
        else if (k === '3') simRef.current?.setReplayAngle('fpv');
        else if (k === '4') simRef.current?.setReplayAngle('orlan');
        else if (k === 'v') handleCycleCamera();
        return;
      }

      if (phase !== 'flying' && phase !== 'recon') return;
      if (k === 'v') handleCycleCamera();
      else if (k === '1') {
        setCameraMode('flir');
        simRef.current?.applyCameraMode('flir');
        setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
      } else if (k === '2') {
        setCameraMode('bhot');
        simRef.current?.applyCameraMode('bhot');
        setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
      } else if (k === '3') {
        setCameraMode('eo');
        simRef.current?.applyCameraMode('eo');
        setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
      } else if (k === '4') {
        setCameraMode('synth');
        simRef.current?.applyCameraMode('synth');
        setTutorialStep((prev) => (prev === 'switch_sensor' ? 'low_altitude' : prev));
      } else if (k === 'z' && phase === 'flying') {
        handleToggleZoom();
      } else if (k === 'escape' && phase === 'flying') {
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, replayStatus?.playing, handleCloseReplay, handleCycleCamera, handleToggleZoom]);

  const handleReconNext = useCallback(() => {
    soundFX.playUIClick();
    const sim = simRef.current;
    if (!sim) return;

    const stats = sim.getStats();
    if (stats.allPrimaryDone || stats.dronesRemaining <= 0) {
      setPhase('debrief');
      return;
    }

    inputRef.current = { yawRoll: 0, pitch: 0, boost: false, airbrake: false };
    sim.launchNextDrone(selectedWarhead);
    if (currentMission.isTutorial) {
      setTutorialStep('second_target');
    }
    setImpactReport(null);
    setPhase('flying');
    setLinkBootFlash(true);
    setTimeout(() => setLinkBootFlash(false), 650);
  }, [currentMission.isTutorial, selectedWarhead]);

  const handleStartFreeHunt = useCallback((cfg: FreeHuntConfig) => {
    soundFX.playUIClick();
    const generated = generateFreeHuntMission(cfg);
    setCustomMission(generated);
    setPhase('briefing');
  }, []);

  const handleUpdateSettings = useCallback((next: ControlSettings) => {
    soundFX.setEnabled(next.soundEnabled);
    setSettings(next);
  }, []);

  const is3DActive =
    phase === 'flying' ||
    phase === 'static_cut' ||
    phase === 'recon' ||
    phase === 'replay' ||
    phase === 'debrief';

  return (
    <div className="fixed inset-0 h-full w-full overflow-hidden bg-[#050a0c]">
      {/* Контейнер WebGL Three.js + HDR Bloom Post-Processing */}
      <div
        ref={mountRef}
        className={`fixed inset-0 h-full w-full ${is3DActive ? 'block' : 'hidden'}`}
      />

      {/* 1. Главное меню штаба дивизиона «Сумрак» */}
      {phase === 'menu' && (
        <MainMenuScreen
          missions={MISSIONS}
          completedIds={completedIds}
          settings={settings}
          defaultCamera={cameraMode}
          onSelectMission={(idx) => {
            soundFX.playUIClick();
            setCustomMission(null);
            setMissionIdx(idx);
            setPhase('briefing');
          }}
          onStartFreeHunt={handleStartFreeHunt}
          onOpenManual={() => {
            soundFX.playUIClick();
            setManualOpen(true);
          }}
          onUpdateSettings={handleUpdateSettings}
          onChangeDefaultCamera={(m) => {
            soundFX.playUIClick();
            setCameraMode(m);
          }}
        />
      )}

      {/* 2. Предполетный тактический планшет */}
      {phase === 'briefing' && (
        <BriefingScreen
          mission={currentMission}
          selectedWarhead={selectedWarhead}
          onSelectWarhead={(wh) => {
            soundFX.playUIClick();
            setSelectedWarhead(wh);
          }}
          onStartSortie={() => startMissionObjSortie(currentMission, selectedWarhead)}
          onOpenManual={() => {
            soundFX.playUIClick();
            setManualOpen(true);
          }}
          onBack={() => {
            soundFX.playUIClick();
            setPhase('menu');
          }}
        />
      )}

      {/* 3. Полет и наведение от первого лица из ГСН «Герань-2М» */}
      {phase === 'flying' && (
        <>
          <StaticNoiseCanvas
            interference={telemetry.ewInterference}
            fullLoss={linkBootFlash}
          />
          <DroneHUD
            telemetry={telemetry}
            mission={currentMission}
            tutorialStep={tutorialStep}
            radioMessage={radioMessage}
            onDismissRadio={() => setRadioMessage(null)}
            onSkipGates={() => simRef.current?.skipTrainingGates()}
            onAdvanceTutorialStep={advanceTutorialStep}
            onCycleCamera={handleCycleCamera}
            onToggleZoom={handleToggleZoom}
            onSelfDetonate={() => simRef.current?.selfDetonate()}
            onOpenPause={() => {
              soundFX.playUIClick();
              setPaused(true);
            }}
          />
          {!paused && !manualOpen && (
            <TouchControls inputRef={inputRef} tutorialStep={tutorialStep} />
          )}
        </>
      )}

      {/* 4. Белый шум потери видеоканала в момент взрыва БЧ */}
      {phase === 'static_cut' && (
        <>
          <StaticNoiseCanvas interference={1} fullLoss={true} />
          <div className="fixed inset-0 z-30 flex flex-col items-center justify-center font-mono select-none pointer-events-none px-4 text-center">
            <div className="bg-black/85 border-2 border-red-500/80 px-5 py-3 shadow-2xl">
              <div className="text-xs sm:text-sm font-bold tracking-[0.25em] text-red-400">
                ПОТЕРЯ КАНАЛА ВИДЕОСВЯЗИ
              </div>
              <div className="mt-1 text-[10px] tracking-widest text-neutral-300">
                ДЕТОНАЦИЯ БЧ · ПЕРЕКЛЮЧЕНИЕ НА БПЛА-РАЗВЕДЧИК «ОРЛАН-30»...
              </div>
            </div>
          </div>
        </>
      )}

      {/* 5. Камера объективного контроля сверху («ОРЛАН-30») */}
      {phase === 'recon' && impactReport && simRef.current && (
        <ReconOverlay
          report={impactReport}
          radioHitLine={currentMission.radioHit}
          stats={simRef.current.getStats()}
          cameraMode={cameraMode}
          selectedWarhead={selectedWarhead}
          onSelectWarhead={(wh) => {
            soundFX.playUIClick();
            setSelectedWarhead(wh);
          }}
          onOpenReplay={() => handleOpenReplay('recon', impactReport.replayIndex)}
          onNextAction={handleReconNext}
          onCycleCamera={handleCycleCamera}
        />
      )}

      {/* 6. Плеер 3D-повтора удара («Чёрный ящик ОК» с 4 камерами и Слоу-мо) */}
      {phase === 'replay' && replayStatus && simRef.current && (
        <ReplayPlayerOverlay
          status={replayStatus}
          cameraMode={cameraMode}
          onSetAngle={(angle) => {
            soundFX.playUIClick();
            simRef.current?.setReplayAngle(angle);
          }}
          onTogglePlay={() => {
            soundFX.playUIClick();
            simRef.current?.setReplayPlaying(!replayStatus.playing);
          }}
          onSetSpeed={(spd) => {
            soundFX.playUIClick();
            simRef.current?.setReplaySpeed(spd);
          }}
          onSeek={(t) => simRef.current?.seekReplay(t)}
          onJumpDive={() => {
            soundFX.playUIClick();
            simRef.current?.jumpReplayToTerminalDive();
          }}
          onRestartFull={() => {
            soundFX.playUIClick();
            simRef.current?.restartReplayFromFullStart();
          }}
          onToggleTrail={() => {
            soundFX.playUIClick();
            simRef.current?.toggleReplayTrail();
          }}
          onCycleCameraMode={handleCycleCamera}
          onClose={handleCloseReplay}
        />
      )}

      {/* 7. Итоговый разбор операции + Видеоархив повторов всех бортов */}
      {phase === 'debrief' && simRef.current && (
        <DebriefScreen
          mission={currentMission}
          completedIds={completedIds}
          replays={simRef.current.getReplays()}
          stats={simRef.current.getStats()}
          hasNextMission={!currentMission.isGenerated && missionIdx < MISSIONS.length - 1}
          onWatchReplay={(repIdx) => handleOpenReplay('debrief', repIdx)}
          onRetry={() => startMissionObjSortie(currentMission, selectedWarhead)}
          onNextMission={() => startCampaignMissionByIdx(missionIdx + 1)}
          onMenu={() => {
            disposeSim();
            setPhase('menu');
          }}
        />
      )}

      {/* Модальное меню паузы и тонкой настройки штурвала */}
      {paused && phase === 'flying' && !manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-emerald-100 select-none">
          <div className="w-full max-w-sm border border-emerald-400/50 bg-[#070f12] p-5 flex flex-col gap-3">
            <div className="text-sm font-bold tracking-[0.25em] text-emerald-300 border-b border-emerald-400/25 pb-2">
              ПАУЗА // НАСТРОЙКИ КАНАЛА
            </div>

            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="border border-cyan-400/50 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900/60"
            >
              ? ОТКРЫТЬ БОЕВОЙ УСТАВ (СПРАВКА)
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({ ...settings, highGraphics: !settings.highGraphics })
              }
              className="flex justify-between border border-emerald-400/30 bg-black/60 px-3 py-2 text-xs"
            >
              <span>HDR СВЕЧЕНИЕ КАМЕРЫ (BLOOM):</span>
              <span className="font-bold text-emerald-300">
                {settings.highGraphics ? 'ВКЛ' : 'ВЫКЛ'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({ ...settings, invertPitch: !settings.invertPitch })
              }
              className="flex justify-between border border-emerald-400/30 bg-black/60 px-3 py-2 text-xs"
            >
              <span>ОСЬ ТАНГАЖА (ВВЕРХ/ВНИЗ):</span>
              <span className="font-bold text-emerald-300">
                {settings.invertPitch ? 'АВИА' : 'ПРЯМАЯ'}
              </span>
            </button>

            <div className="border border-emerald-400/30 bg-black/60 px-3 py-2 text-xs">
              <div className="flex justify-between mb-1">
                <span>ЧУВСТВИТЕЛЬНОСТЬ РУЛЕЙ:</span>
                <span className="font-bold">{Math.round(settings.sensitivity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.6"
                max="1.6"
                step="0.1"
                value={settings.sensitivity}
                onChange={(e) =>
                  handleUpdateSettings({
                    ...settings,
                    sensitivity: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-400"
              />
            </div>

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled })
              }
              className="flex justify-between border border-emerald-400/30 bg-black/60 px-3 py-2 text-xs"
            >
              <span>АУДИОКАНАЛ ДВИГАТЕЛЯ:</span>
              <span className="font-bold">{settings.soundEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>

            <div className="flex flex-col gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => setPaused(false)}
                className="py-2.5 bg-emerald-500/30 border border-emerald-300 text-xs font-bold tracking-wider text-white"
              >
                ПРОДОЛЖИТЬ ПОЛЁТ
              </button>
              <button
                type="button"
                onClick={() => startMissionObjSortie(currentMission, selectedWarhead)}
                className="py-2 bg-amber-500/15 border border-amber-400/45 text-xs text-amber-200"
              >
                НАЧАТЬ ОПЕРАЦИЮ ЗАНОВО
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaused(false);
                  disposeSim();
                  setPhase('menu');
                }}
                className="py-2 bg-red-950/50 border border-red-400/40 text-xs text-red-200"
              >
                ВЫЙТИ В ШТАБ (МЕНЮ)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Интерактивный Боевой Устав / Справочник оператора */}
      {manualOpen && <FieldManualModal onClose={() => setManualOpen(false)} />}
    </div>
  );
}
