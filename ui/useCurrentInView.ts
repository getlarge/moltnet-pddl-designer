import { useEffect, useRef } from 'react';

/** Keep the active item in its horizontal rail without moving the page. */
export function useCurrentInView<T extends HTMLElement>(
  selection: string | number,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    const reveal = () => {
      const current = rail.querySelector<HTMLElement>('[aria-current]');
      if (!current || rail.scrollWidth <= rail.clientWidth) return;
      const bounds = rail.getBoundingClientRect();
      const item = current.getBoundingClientRect();
      if (item.left < bounds.left) rail.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        rail.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [selection]);
  return ref;
}
