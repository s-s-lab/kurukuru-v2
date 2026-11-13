export type PointerPoint = { clientX: number; clientY: number };

export type PointerPathGeometry = {
  xEdges: number[];
  yEdges: number[];
};

/** Measure the rendered grid once at the start of a pointer gesture. */
export function measurePointerPath(container: HTMLElement, selector: string): PointerPathGeometry {
  const boundaries = new Set<Element>([container]);
  // Ancestor edges cover scroll clipping; header edges cover sticky date columns.
  for (const cell of container.querySelectorAll(`${selector}, th`)) {
    for (let element: Element | null = cell; element && container.contains(element); element = element.parentElement) {
      if (boundaries.has(element)) break;
      boundaries.add(element);
    }
  }

  const xEdges = new Set<number>();
  const yEdges = new Set<number>();
  for (const element of boundaries) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    xEdges.add(rect.left);
    xEdges.add(rect.right);
    yEdges.add(rect.top);
    yEdges.add(rect.bottom);
  }
  return { xEdges: [...xEdges], yEdges: [...yEdges] };
}

/** Hit-test each portion of a pointer segment separated by a rendered grid edge. */
export function paintPointerPath(
  container: HTMLElement,
  selector: string,
  geometry: PointerPathGeometry,
  from: PointerPoint,
  to: PointerPoint,
  paint: (cell: HTMLElement) => void,
  fallbackTarget: EventTarget | null,
) {
  const document_ = container.ownerDocument;
  function paintHit(hit: Element | null) {
    const cell = hit?.closest<HTMLElement>(selector);
    if (cell && container.contains(cell) && !cell.matches(':disabled')) paint(cell);
  }
  if (typeof document_.elementFromPoint !== 'function') {
    paintHit(fallbackTarget instanceof Element ? fallbackTarget : null);
    return;
  }

  const dx = to.clientX - from.clientX;
  const dy = to.clientY - from.clientY;
  if (!dx && !dy) {
    paintHit(document_.elementFromPoint(to.clientX, to.clientY));
    return;
  }
  const stops = new Set([0, 1]);
  function addStop(edge: number, origin: number, distance: number) {
    if (!distance) return;
    const position = (edge - origin) / distance;
    if (position > 0 && position < 1) stops.add(position);
  }
  for (const edge of geometry.xEdges) addStop(edge, from.clientX, dx);
  for (const edge of geometry.yEdges) addStop(edge, from.clientY, dy);
  function paintAt(position: number) {
    paintHit(document_.elementFromPoint(from.clientX + dx * position, from.clientY + dy * position));
  }
  const positions = [...stops].sort((left, right) => left - right);
  // Midpoints also catch arbitrarily small diagonal corner crossings, unlike
  // fixed pixel sampling. Hit-testing excludes borders, headers and hidden cells.
  paintAt(0);
  for (let index = 1; index < positions.length; index += 1) {
    paintAt((positions[index - 1] + positions[index]) / 2);
  }
  paintAt(1);
}
