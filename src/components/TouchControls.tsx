import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { FlightInput, TutorialStep } from '../game/types';
import { computeStickFromDelta, keyboardToAxes, mergeAxes } from '../game/controlMath';

interface TouchControlsProps {
  inputRef: MutableRefObject<FlightInput>;
  tutorialStep: TutorialStep;
  onBoostActivated?: () => void;
}

const MAX_RADIUS = 52;
const EMPTY_INPUT: FlightInput = { yawRoll: 0, pitch: 0, boost: false, airbrake: false };

export function TouchControls({ inputRef, tutorialStep, onBoostActivated }: TouchControlsProps) {
  const [stickActive, setStickActive] = useState(false);
  const [boostHeld, setBoostHeld] = useState(false);
  const [brakeHeld, setBrakeHeld] = useState(false);

  const activePointerIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const pointerAxesRef = useRef({ yawRoll: 0, pitch: 0 });
  const keysPressedRef = useRef<Set<string>>(new Set());

  const boostPointerIdRef = useRef<number | null>(null);
  const brakePointerIdRef = useRef<number | null>(null);
  const boostHeldRef = useRef(false);
  const brakeHeldRef = useRef(false);

  const stickBaseRef = useRef<HTMLDivElement>(null);
  const stickKnobRef = useRef<HTMLDivElement>(null);
  const onBoostActivatedRef = useRef(onBoostActivated);
  onBoostActivatedRef.current = onBoostActivated;

  const syncAxes = useCallback(() => {
    const merged = mergeAxes(
      activePointerIdRef.current !== null,
      pointerAxesRef.current,
      keyboardToAxes(keysPressedRef.current)
    );
    inputRef.current.yawRoll = merged.yawRoll;
    inputRef.current.pitch = merged.pitch;
  }, [inputRef]);

  const syncThrottle = useCallback(() => {
    const keys = keysPressedRef.current;
    const brake = brakeHeldRef.current || keys.has('control') || keys.has('c');
    const boost = !brake && (boostHeldRef.current || keys.has('shift') || keys.has(' '));
    inputRef.current.boost = boost;
    inputRef.current.airbrake = brake;
    if (boost) onBoostActivatedRef.current?.();
  }, [inputRef]);

  const resetStickVisual = useCallback(() => {
    if (stickKnobRef.current) {
      stickKnobRef.current.style.transform = 'translate(0px, 0px)';
    }
    if (stickBaseRef.current) {
      stickBaseRef.current.style.opacity = '0';
    }
  }, []);

  const clearAllInput = useCallback(() => {
    activePointerIdRef.current = null;
    boostPointerIdRef.current = null;
    brakePointerIdRef.current = null;
    pointerAxesRef.current = { yawRoll: 0, pitch: 0 };
    keysPressedRef.current.clear();
    boostHeldRef.current = false;
    brakeHeldRef.current = false;
    inputRef.current = { ...EMPTY_INPUT };
    setStickActive(false);
    setBoostHeld(false);
    setBrakeHeld(false);
    resetStickVisual();
  }, [inputRef, resetStickVisual]);

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const stick = computeStickFromDelta(
        clientX - originRef.current.x,
        clientY - originRef.current.y,
        MAX_RADIUS
      );
      pointerAxesRef.current = {
        yawRoll: stick.x,
        pitch: -stick.y,
      };
      if (stickKnobRef.current) {
        stickKnobRef.current.style.transform = `translate(${stick.knobX}px, ${stick.knobY}px)`;
      }
      syncAxes();
    },
    [syncAxes]
  );

  const endStickPointer = useCallback(
    (pointerId: number) => {
      if (activePointerIdRef.current !== pointerId) return;
      activePointerIdRef.current = null;
      pointerAxesRef.current = { yawRoll: 0, pitch: 0 };
      setStickActive(false);
      resetStickVisual();
      // Если клавиши WASD всё ещё зажаты, syncAxes плавно вернёт управление клавиатуре.
      syncAxes();
    },
    [resetStickVisual, syncAxes]
  );

  const handleStickDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Указатель уже завершён браузером — просто игнорируем.
      }
      activePointerIdRef.current = e.pointerId;
      originRef.current = { x: e.clientX, y: e.clientY };
      setStickActive(true);

      if (stickBaseRef.current) {
        stickBaseRef.current.style.left = `${e.clientX}px`;
        stickBaseRef.current.style.top = `${e.clientY}px`;
        stickBaseRef.current.style.opacity = '1';
      }
      applyPointer(e.clientX, e.clientY);
    },
    [applyPointer]
  );

  const handleStickMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      e.preventDefault();
      applyPointer(e.clientX, e.clientY);
    },
    [applyPointer]
  );

  const handleStickEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      endStickPointer(e.pointerId);
    },
    [endStickPointer]
  );

  const setBoost = useCallback(
    (held: boolean) => {
      boostHeldRef.current = held;
      setBoostHeld(held);
      syncThrottle();
    },
    [syncThrottle]
  );

  const setBrake = useCallback(
    (held: boolean) => {
      brakeHeldRef.current = held;
      setBrakeHeld(held);
      syncThrottle();
    },
    [syncThrottle]
  );

  const makeHoldHandlers = useCallback(
    (kind: 'boost' | 'brake') => {
      const idRef = kind === 'boost' ? boostPointerIdRef : brakePointerIdRef;
      const setHeld = kind === 'boost' ? setBoost : setBrake;
      return {
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (idRef.current !== null) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // noop
          }
          idRef.current = e.pointerId;
          setHeld(true);
        },
        onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.pointerId !== idRef.current) return;
          idRef.current = null;
          setHeld(false);
        },
        onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.pointerId !== idRef.current) return;
          idRef.current = null;
          setHeld(false);
        },
        onLostPointerCapture: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.pointerId !== idRef.current) return;
          idRef.current = null;
          setHeld(false);
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };
    },
    [setBoost, setBrake]
  );

  const boostHandlers = makeHoldHandlers('boost');
  const brakeHandlers = makeHoldHandlers('brake');

  useEffect(() => {
    const handledKeys = new Set([
      'w',
      'a',
      's',
      'd',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      'shift',
      ' ',
      'control',
      'c',
    ]);

    const normalizeKey = (e: KeyboardEvent) => (e.key === ' ' ? ' ' : e.key.toLowerCase());

    const onKeyDown = (e: KeyboardEvent) => {
      const key = normalizeKey(e);
      if (!handledKeys.has(key)) return;
      // Особенно важно для Space/стрелок: иначе браузер скроллит страницу или повторно нажимает сфокусированную кнопку.
      e.preventDefault();
      keysPressedRef.current.add(key);
      syncAxes();
      syncThrottle();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = normalizeKey(e);
      if (!handledKeys.has(key)) return;
      e.preventDefault();
      keysPressedRef.current.delete(key);
      syncAxes();
      syncThrottle();
    };

    const onVisibility = () => {
      if (document.hidden) clearAllInput();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAllInput);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAllInput);
      document.removeEventListener('visibilitychange', onVisibility);
      inputRef.current = { ...EMPTY_INPUT };
    };
  }, [clearAllInput, inputRef, syncAxes, syncThrottle]);

  const highlightStick = tutorialStep === 'steer_gates' || tutorialStep === 'low_altitude' || tutorialStep === 'manual_aim';
  const highlightBoost = tutorialStep === 'boost_impact';

  return (
    <div className="fixed inset-0 z-30 pointer-events-none select-none font-mono">
      {/* Сенсорная зона штурвала: один Pointer Events поток для мыши, пера и мультитача. */}
      <div
        className="pointer-events-auto fixed left-0 bottom-0 top-14 w-[72%]"
        style={{ touchAction: 'none' }}
        onPointerDown={handleStickDown}
        onPointerMove={handleStickMove}
        onPointerUp={handleStickEnd}
        onPointerCancel={handleStickEnd}
        onLostPointerCapture={handleStickEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!stickActive && (
          <div className="fixed left-5 bottom-6 flex flex-col items-center gap-1.5">
            <div
              className={`h-24 w-24 rounded-full backdrop-blur-[1px] flex items-center justify-center relative transition-all ${
                highlightStick
                  ? 'border-2 border-amber-300 bg-amber-500/15 animate-pulse shadow-[0_0_24px_rgba(245,158,11,0.5)]'
                  : 'border border-emerald-300/35 bg-black/35 opacity-80'
              }`}
            >
              <div className="h-10 w-10 rounded-full border border-emerald-300/60 bg-emerald-400/15 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-emerald-300" />
              </div>
              <span className="absolute top-1.5 text-[8px] text-emerald-200/70">ВВЕРХ</span>
              <span className="absolute bottom-1.5 text-[8px] text-emerald-200/70">ПИКИР.</span>
            </div>
            <span className="text-[9px] tracking-widest text-emerald-200/75 bg-black/60 px-1.5 py-0.5">
              ШТУРВАЛ · РУЧНОЙ РЕЖИМ
            </span>
          </div>
        )}
      </div>

      {/* Активный плавающий джойстик всегда существует в DOM: движение обновляет только transform ручки. */}
      <div
        ref={stickBaseRef}
        style={{
          left: '-200px',
          top: '-200px',
          transform: 'translate(-50%, -50%)',
          opacity: 0,
          transition: 'opacity 70ms linear',
        }}
        className="fixed h-28 w-28 rounded-full border-2 border-emerald-300/45 bg-black/30 flex items-center justify-center pointer-events-none"
      >
        <div
          ref={stickKnobRef}
          className="h-12 w-12 rounded-full border-2 border-emerald-300 bg-emerald-400/25 shadow-[0_0_16px_rgba(52,211,153,0.45)] flex items-center justify-center will-change-transform"
        >
          <div className="h-2.5 w-2.5 rounded-full bg-white" />
        </div>
      </div>

      {/* Правый пульт тяги. Форсаж работает только пока кнопка реально удерживается — без скрытой фиксации. */}
      <div className="pointer-events-auto fixed right-3.5 bottom-5 flex flex-col items-end gap-2.5">
        <div className="bg-black/65 border border-emerald-400/25 px-2 py-1 text-[8.5px] tracking-widest text-emerald-200/70">
          АВТОЗАХВАТА НЕТ · ЦЕЛЬСЯ ВРУЧНУЮ
        </div>

        <button
          type="button"
          tabIndex={-1}
          {...brakeHandlers}
          className={`px-3 py-2 text-[10px] font-bold tracking-wider border transition-colors touch-none ${
            brakeHeld
              ? 'bg-sky-500/40 border-sky-300 text-white'
              : 'bg-black/65 border-emerald-400/35 text-emerald-200/85'
          }`}
        >
          ▼ МАЛЫЙ ГАЗ · ДЕРЖАТЬ
        </button>

        <button
          type="button"
          tabIndex={-1}
          {...boostHandlers}
          className={`h-[74px] w-28 sm:h-20 sm:w-32 flex flex-col items-center justify-center border-2 transition-colors touch-none ${
            boostHeld
              ? 'bg-amber-500/40 border-amber-300 text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.55)]'
              : highlightBoost
              ? 'bg-amber-500/30 border-amber-300 text-white animate-pulse shadow-[0_0_24px_rgba(245,158,11,0.75)]'
              : 'bg-black/65 border-amber-400/50 text-amber-200'
          }`}
        >
          <span className="text-xs sm:text-sm font-bold tracking-wider">▲ ФОРСАЖ</span>
          <span className="text-[9px] opacity-80">{boostHeld ? 'МАКС. ОБОРОТЫ' : 'ДЕРЖАТЬ'}</span>
        </button>
      </div>
    </div>
  );
}
