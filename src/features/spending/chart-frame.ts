import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

// Drawn to the width of its box, so the text keeps its size on a phone and on a wide page.
const MIN_WIDTH = 240;
export const HEIGHT = 210;
export const PAD = { top: 14, right: 12, bottom: 24, left: 54 };
export const TICKS = 4;

/** The box to put on the plot, and the width to draw it at. */
export function useDrawingWidth() {
  const plot = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(360);
  useLayoutEffect(() => {
    const box = plot.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setBoxWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return { plot, width: Math.max(boxWidth, MIN_WIDTH) };
}

/** The point under a finger, the pointer or the arrow keys; `rest` is where keys start. */
export function useChartPointer(count: number, width: number, rest: number) {
  const [active, setActive] = useState<number | null>(null);

  function pointAt(event: PointerEvent<SVGSVGElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const inDrawing = ((event.clientX - box.left) / box.width) * width;
    const plotWidth = width - PAD.left - PAD.right;
    const index = Math.round(((inDrawing - PAD.left) / plotWidth) * (count - 1));
    return Math.min(Math.max(index, 0), count - 1);
  }

  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => setActive(pointAt(event)),
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => setActive(pointAt(event)),
    onPointerLeave: () => setActive(null),
    onFocus: () => setActive(rest),
    onBlur: () => setActive(null),
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      setActive(Math.min(Math.max((active ?? rest) + step, 0), count - 1));
    },
  };
  return { active, handlers };
}
