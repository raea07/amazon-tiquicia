/**
 * The mark's geometry as plain data, for places that cannot render the DOM
 * component in `logo.tsx`: e-mail templates, exported files and the native
 * apps (which draw it with react-native-svg). Kept free of React so that
 * importing it never pulls a second copy of React into a native bundle.
 *
 * 48×48 grid, one path with a 6-unit round stroke, two nodes of radius 6.
 */
export const markGeometry = {
  viewBox: "0 0 48 48",
  path: "M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42",
  strokeWidth: 6,
  nodes: [
    { cx: 12, cy: 11, r: 6 },
    { cx: 36, cy: 11, r: 6 },
  ],
} as const;
