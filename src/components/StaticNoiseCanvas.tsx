import { useEffect, useRef } from 'react';

interface StaticNoiseCanvasProps {
  /** 0..1 уровень помех РЭБ во время полета */
  interference: number;
  /** true в момент детонации БПЛА (100% потеря несущей видеосигнала) */
  fullLoss: boolean;
}

export function StaticNoiseCanvas({ interference, fullLoss }: StaticNoiseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const level = fullLoss ? 1 : interference;
    if (level <= 0.02) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 240;
    const h = 160;
    canvas.width = w;
    canvas.height = h;

    const img = ctx.createImageData(w, h);
    const data = img.data;
    let raf = 0;

    const draw = () => {
      if (fullLoss) {
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.random() * 255;
          data[i] = v;
          data[i + 1] = v * 1.02;
          data[i + 2] = v * 0.98;
          data[i + 3] = 245;
        }
        ctx.putImageData(img, 0, 0);
        // Полосы срыва кадровой развертки
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, (Math.random() * h) | 0, w, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(0, (Math.random() * h) | 0, w, 4);
      } else {
        ctx.clearRect(0, 0, w, h);
        // Точки цифрового снега от глушилки РЭБ
        const dots = Math.floor(level * 950);
        ctx.fillStyle = `rgba(225, 255, 245, ${0.18 + level * 0.45})`;
        for (let i = 0; i < dots; i++) {
          ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 1);
        }
        // Горизонтальные полосы срыва радиоканала
        consttearCount = Math.floor(level * 6);
        for (let b = 0; b < consttearCount; b++) {
          if (Math.random() < level * 0.85) {
            const by = (Math.random() * h) | 0;
            const bh = 1 + ((Math.random() * 6 * level) | 0);
            ctx.fillStyle =
              Math.random() > 0.35
                ? `rgba(200, 255, 240, ${0.15 + level * 0.38})`
                : `rgba(8, 14, 16, ${0.35 + level * 0.4})`;
            ctx.fillRect(0, by, w, bh);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };

    let consttearCount = 0;
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [interference, fullLoss]);

  if (!fullLoss && interference <= 0.02) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-20 h-full w-full"
      style={{
        imageRendering: 'pixelated',
        opacity: fullLoss ? 1 : Math.min(0.92, interference * 0.95),
      }}
    />
  );
}
