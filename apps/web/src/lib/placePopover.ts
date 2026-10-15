/**
 * Places a `position: fixed` popover below `anchor`, flipped above when there is no room, kept on
 * screen (no CSS anchor positioning in every browser yet).
 */
export function placePopover(anchor: Element, el: HTMLElement, matchWidth = false) {
  const r = anchor.getBoundingClientRect();
  if (matchWidth) el.style.minWidth = `${r.width}px`;
  const h = el.offsetHeight;
  const vh = window.innerHeight;
  const top = r.bottom + 4 + h > vh - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : r.bottom + 4;
  el.style.top = `${Math.max(8, Math.min(top, vh - h - 8))}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - el.offsetWidth - 8))}px`;
}
