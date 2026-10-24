export interface RuntimePolicies {
  divNegative: "truncate" | "floor";
  intNegative: "truncate" | "floor";
  roundHalf: "away" | "even";
  forBounds: "once" | "eachIteration";
  shortCircuit: boolean;
  realOutput: "compact" | "preserve";
  booleanOutput: "upper" | "lower";
  filenameCase: "sensitive" | "insensitive";
}
export const defaultPolicies: RuntimePolicies = {
  divNegative: "truncate",
  intNegative: "truncate",
  roundHalf: "away",
  forBounds: "once",
  shortCircuit: true,
  realOutput: "compact",
  booleanOutput: "upper",
  filenameCase: "sensitive",
};
export function round(value: number, places: number, half: "away" | "even") {
  const scale = 10 ** places,
    x = (Math.abs(value) + Number.EPSILON) * scale;
  const low = Math.floor(x),
    fraction = x - low;
  const result =
    half === "even" && Math.abs(fraction - 0.5) < 1e-12
      ? low % 2 === 0
        ? low
        : low + 1
      : Math.floor(x + 0.5);
  return (Math.sign(value) * result) / scale;
}
