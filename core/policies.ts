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
  // Round the decimal representation, rather than multiplying a binary float.
  // This preserves ties such as 10.075 and cannot overflow while scaling 1e308.
  const [mantissa, exponent = "0"] = Math.abs(value).toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const shift = places + Number(exponent) - fraction.length;
  if (shift >= 0) return value;
  const digits = BigInt(whole + fraction),
    divisor = 10n ** BigInt(-shift),
    low = digits / divisor,
    remainder = digits % divisor;
  const up =
    remainder * 2n > divisor ||
    (remainder * 2n === divisor && (half === "away" || low % 2n !== 0n));
  return Math.sign(value) * Number(`${low + (up ? 1n : 0n)}e-${places}`);
}
