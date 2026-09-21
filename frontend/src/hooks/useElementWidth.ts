import { RefObject, useEffect, useState } from "react";

export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}