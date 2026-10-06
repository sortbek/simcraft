// Theme-aware hairline/overlay/shade colors for inline styles and SVG (globals.css --c-line etc.).
const mix = (name: string) => (a: number) =>
  `rgb(var(--c-${name}) / calc(${a} * var(--c-${name}-k)))`;

export const line = mix('line');
export const overlay = mix('overlay');
export const shade = mix('shade');
