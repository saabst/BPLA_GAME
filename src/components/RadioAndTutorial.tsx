import { useState } from 'react';
import type { RadioLine, TutorialStep } from '../game/types';

interface RadioCommsBannerProps {
  message: RadioLine | null;
  onDismiss: () => void;
}

export function RadioCommsBanner({ message, onDismiss }: RadioCommsBannerProps) {
  if (!message) return null;

  const toneBorder =
    message.tone === 'warn'
      ? 'border-amber-400/80 bg-amber-950/80 text-amber-100'
      : message.tone === 'praise'
      ? 'border-emerald-400/85 bg-emerald-950/85 text-emerald-100'
      : 'border-cyan-400/65 bg-[#041318]/85 text-emerald-100';

  return (
    <div
      onClick={onDismiss}
      className={`pointer-events-auto mx-auto max-w-md border-l-4 px-3 py-2 font-mono backdrop-blur-sm shadow-lg transition-all cursor-pointer ${toneBorder}`}
    >
      <div className="flex items-center justify-between gap-2 text-[9px] tracking-widest opacity-85">
        <div className="flex items-center gap-1.5 font-bold text-emerald-300">
          {/* Мини-эквалайзер УКВ радиоканала */}
          <span className="inline-flex items-end gap-[2px] h-2.5">
            <span className="w-[2px] h-1.5 bg-emerald-400 animate-pulse" />
            <span className="w-[2px] h-2.5 bg-emerald-300 animate-bounce" />
            <span className="w-[2px] h-1 bg-emerald-400 animate-pulse" />
          </span>
          <span>РАДИОЭФИР // {message.speaker}</span>
        </div>
        <span className="opacity-65">{message.role}</span>
      </div>
      <div className="mt-1 text-[11px] sm:text-xs leading-snug text-white">
        «{message.text}»
      </div>
    </div>
  );
}

interface TutorialCoachProps {
  step: TutorialStep;
  gatesPassed: number;
  gatesTotal: number;
  aglM: number;
  onSkipGates: () => void;
  onAdvanceStep: () => void;
}

export function TutorialCoachCard({
  step,
  gatesPassed,
  gatesTotal,
  aglM,
  onSkipGates,
  onAdvanceStep,
}: TutorialCoachProps) {
  if (step === 'none') return null;

  const stepMeta: Record<
    Exclude<TutorialStep, 'none'>,
    { idx: string; title: string; body: string; actionHint: string }
  > = {
    steer_gates: {
      idx: 'ШАГ 1/5 · ПИЛОТИРОВАНИЕ',
      title: `ПРОЙДИТЕ СТВОРЫ В НЕБЕ (${gatesPassed}/${gatesTotal})`,
      body: 'Зажмите левую часть экрана и плавно ведите палец (на ПК — зажмите ЛКМ или клавиши WASD), чтобы направить крестик БПЛА в центр светящихся колец.',
      actionHint: 'Штурвал слева управляет курсом и углом пикирования',
    },
    switch_sensor: {
      idx: 'ШАГ 2/5 · ОПТИКА И ТЕПЛОВИЗОР',
      title: 'ПЕРЕКЛЮЧИТЕ КАМЕРУ И ЗУМ',
      body: 'Нажмите мигающую кнопку режима камеры в правом верхнем углу (ТПВ / ТВ / ВИЗОР) или зум 2.5× (клавиши V и Z). В тепловизоре горячая бронетехника врага светится ярко-белым!',
      actionHint: 'Нажмите кнопку режима камеры или зума сверху справа',
    },
    low_altitude: {
      idx: 'ШАГ 3/5 · ПРОРЫВ ПОД РАДАРОМ',
      title: `СНИЗЬТЕСЬ НИЖЕ 60 М (СЕЙЧАС: ${aglM} М)`,
      body: 'Ракеты ЗРК «фашиков» не видят цели у земли! Потяните штурвал вниз (клавиша S), чтобы опустить высоту РВ ниже 60 метров — но не врежьтесь в землю!',
      actionHint: 'Следите за шкалой «ВЫСОТА РВ» справа на экране',
    },
    manual_aim: {
      idx: 'ШАГ 4/5 · РУЧНОЕ ПРИЦЕЛИВАНИЕ',
      title: 'ДЕРЖИТЕ ТАНК ТОЧНО В ПЕРЕКРЕСТИИ',
      body: 'Автозахвата больше нет: только штурвал оператора. Малыми движениями удерживайте перекрестие на башне/двигательном отсеке танка; янтарная подсказка лишь подтверждает, что цель находится у центра кадра.',
      actionHint: 'Для точной коррекции используйте малый газ и зум 2.5×',
    },
    boost_impact: {
      idx: 'ШАГ 5/5 · ТЕРМИНАЛЬНЫЙ УДАР',
      title: 'ВКЛЮЧИТЕ «ФОРСАЖ» И ПОРАЗИТЕ МИШЕНЬ!',
      body: 'Нажмите «▲ ФОРСАЖ» справа (или Shift/Пробел): двигатель МД-550 разгонит «Герань-2М» до 315 км/ч! Дождитесь прямого попадания 50-кг боевой части в танк!',
      actionHint: 'В момент взрыва связь оборвётся и включится БПЛА-разведчик',
    },
    second_target: {
      idx: 'ЗАЧЁТНЫЙ УДАР · БОРТ #2',
      title: 'УНИЧТОЖЬТЕ МАКЕТ ГРУЗОВИКА С БК!',
      body: 'Самостоятельно вручную наведите второй борт «Герань-2М» на грузовик с боекомплектом на полигоне, удерживайте ФОРСАЖ и оцените мощь вторичной детонации!',
      actionHint: 'Уничтожьте оставшуюся мишень для завершения обучения',
    },
  };

  const info = stepMeta[step];

  return (
    <div className="pointer-events-auto mx-auto max-w-md bg-[#041417]/90 border-2 border-emerald-400/75 px-3 py-2 font-mono shadow-[0_0_24px_rgba(16,185,129,0.28)]">
      <div className="flex items-center justify-between gap-2 text-[9px] tracking-widest text-emerald-300">
        <span className="font-bold">★ ИНСТРУКТОР // {info.idx}</span>
        {step !== 'second_target' && (
          <button
            type="button"
            onClick={() => {
              if (step === 'steer_gates') onSkipGates();
              else onAdvanceStep();
            }}
            className="border border-emerald-400/40 bg-emerald-950/70 px-1.5 py-0.5 text-[9px] text-emerald-200 hover:bg-emerald-800/60"
          >
            ДАЛЕЕ ›
          </button>
        )}
      </div>
      <div className="mt-0.5 text-xs font-bold text-white">{info.title}</div>
      <p className="mt-0.5 text-[10.5px] leading-snug text-emerald-100/90">{info.body}</p>
      <div className="mt-1 text-[9.5px] text-amber-300/95">▸ {info.actionHint}</div>
    </div>
  );
}

interface FieldManualModalProps {
  onClose: () => void;
}

export function FieldManualModal({ onClose }: FieldManualModalProps) {
  const [tab, setTab] = useState<'flight' | 'sensors' | 'tactics' | 'targets'>('flight');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-5 font-mono text-emerald-100 select-none">
      <div className="w-full max-w-xl max-h-[88vh] overflow-y-auto border border-emerald-400/50 bg-[#061014] p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-emerald-400/25 pb-2.5">
          <div>
            <div className="text-[9px] tracking-[0.3em] text-emerald-400">
              ДИВИЗИОН «СУМРАК» // ПАМЯТКА ОПЕРАТОРА
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-wider text-white">
              БОЕВОЙ УСТАВ «ГЕРАНЬ-2М»
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-emerald-400/40 bg-emerald-950/60 px-3 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-900"
          >
            ✕ ЗАКРЫТЬ
          </button>
        </div>

        {/* Вкладки устава */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
          {[
            { id: 'flight', label: '1. ПИЛОТАЖ И ГСН' },
            { id: 'sensors', label: '2. КАМЕРА И ЗУМ' },
            { id: 'tactics', label: '3. ПВО И РЭБ' },
            { id: 'targets', label: '4. ЦЕЛИ ВРАГА' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`py-2 px-2 border font-bold tracking-wider ${
                tab === t.id
                  ? 'bg-emerald-500/30 border-emerald-300 text-white'
                  : 'bg-black/50 border-emerald-400/25 text-emerald-300/75'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'flight' && (
          <div className="space-y-2.5 text-xs text-slate-200 leading-relaxed">
            <div className="border border-emerald-400/25 bg-black/50 p-3">
              <div className="font-bold text-emerald-300 mb-1">ПРИНЦИП БОЕВОГО ПРИМЕНЕНИЯ</div>
              <p>
                «Герань-2М» — это барражирующий боеприпас (дрон-камикадзе) с осколочно-фугасной БЧ массой <strong>50 кг (ОФБЧ-50)</strong>. Дрон не стреляет ракетами — вы управляете самим планером от первого лица и направляете его прямо в военный объект врага. После взрыва связь обрывается, а результат фиксирует с высоты БПЛА-разведчик «Орлан-30».
              </p>
            </div>
            <div className="border border-emerald-400/25 bg-black/50 p-3 space-y-1.5">
              <div className="font-bold text-amber-300">ОРГАНЫ УПРАВЛЕНИЯ (СМАРТФОН / ПК)</div>
              <p>• <strong>Штурвал (левая часть экрана / ЛКМ / WASD):</strong> крен, курс и угол пикирования.</p>
              <p>• <strong>АВТОЗАХВАТА НЕТ:</strong> камера и рамки ИИ только обозначают объект и дистанцию. Курс, крен, высоту и момент пикирования полностью задаёт оператор штурвалом — автопилот не доводит БПЛА до цели.</p>
              <p>• <strong>▲ ФОРСАЖ (кнопка справа / Shift / Пробел):</strong> максимальные обороты двигателя МД-550 — разгон до <strong>315 км/ч</strong> для стремительного прорыва зенитного огня.</p>
              <p>• <strong>▼ МАЛЫЙ ГАЗ (Ctrl / C):</strong> замедление до 146 км/ч для ювелирного доворота на цель.</p>
            </div>
          </div>
        )}

        {tab === 'sensors' && (
          <div className="space-y-2.5 text-xs text-slate-200 leading-relaxed">
            <div className="border border-emerald-400/25 bg-black/50 p-3">
              <div className="font-bold text-emerald-200">● ТПВ БЕЛ / ТПВ ЧЁРН (ДВЕ ПОЛЯРНОСТИ ТЕПЛОВИЗОРА)</div>
              <p className="mt-1">
                Два классических инфракрасных режима («Горячий белый» и «Горячий чёрный»): раскалённые дизели танков, генераторы РЛС, кунги РЭБ и сопла самолётов контрастно выделяются на фоне холодной пашни в любое время суток.
              </p>
            </div>
            <div className="border border-emerald-400/25 bg-black/50 p-3">
              <div className="font-bold text-emerald-200">● ТВ ОПТИКА И ВИЗОР ИИ</div>
              <p className="mt-1">
                Цветная ТВ-оптика передаёт реальную картинку ТВД, а нейросетевой <strong>ВИЗОР ИИ</strong> накладывает сетку квадратов, подсвечивает 3D-грани целей и отображает полусферу подавления РЭБ.
              </p>
            </div>
            <div className="border border-cyan-400/35 bg-cyan-950/20 p-3">
              <div className="font-bold text-cyan-300">🎥 3D-ПОВТОР «ЧЁРНЫЙ ЯЩИК ОК»</div>
              <p className="mt-1">
                После каждого попадания вы можете открыть 3D-повтор с <strong>4 ракурсов</strong> (за крылом вашей «Герани», с земли глазами врага, из ГСН и с «Орлана»), включить <strong>0.25× Слоу-мо</strong> и перемотать момент детонации!
              </p>
            </div>
          </div>
        )}

        {tab === 'tactics' && (
          <div className="space-y-2.5 text-xs text-slate-200 leading-relaxed">
            <div className="border border-red-400/35 bg-red-950/20 p-3">
              <div className="font-bold text-red-300">1. КАК УЙТИ ОТ РАКЕТ ЗРК (ПРАВИЛО 60 МЕТРОВ)</div>
              <p className="mt-1">
                Батареи ЗРК «фашиков» видят и сбивают цели на средних высотах. Стоит опустить дрон <strong>ниже 60 метров по радиовысотомеру (ВЫСОТА РВ)</strong> — срабатывает маскировка рельефом, и даже уже выпущенная зенитная ракета теряет захват!
              </p>
            </div>
            <div className="border border-amber-400/35 bg-amber-950/20 p-3">
              <div className="font-bold text-amber-300">2. КАК ПРОБИТЬ КУПОЛ СТАНЦИИ РЭБ</div>
              <p className="mt-1">
                Машина РЭБ «Купол-Р» вызывает сильные видеопомехи и увод рулей. Включите <strong>ТПВ</strong>, удерживайте белое пятно горячего генератора машины РЭБ в центре прицела и компенсируйте дрейф малыми движениями штурвала. После взрыва машины РЭБ связь очистится для всей волны.
              </p>
            </div>
          </div>
        )}

        {tab === 'targets' && (
          <div className="space-y-2 text-xs text-slate-200 leading-relaxed">
            <div className="border border-emerald-400/25 bg-black/50 p-3 space-y-1.5">
              <div className="font-bold text-emerald-300">ВТОРИЧНАЯ КАСКАДНАЯ ДЕТОНАЦИЯ (РАДИУС 95 М!)</div>
              <p>
                Некоторые объекты корпуса «Чёрный Клин» набиты топливом и боеприпасами. Точный удар в них вызывает грандиозный вторичный взрыв, уничтожающий всю соседнюю технику в радиусе 95 метров:
              </p>
              <ul className="list-disc pl-5 text-amber-200 space-y-1">
                <li><strong>Полевой парк / Терминал ГСМ</strong> — взрыв тысяч тонн авиакеросина и солярки;</li>
                <li><strong>Грузовик снабжения с БК</strong> — детонация танковых снарядов прямо посреди колонны на марше;</li>
                <li><strong>Пусковая установка ЗРК</strong> — подрыв твёрдотопливных ракет в контейнерах ТПК.</li>
              </ul>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400 text-xs font-bold tracking-widest text-white"
        >
          ПОНЯТНО — ГОТОВ К ВЫЛЕТУ
        </button>
      </div>
    </div>
  );
}
