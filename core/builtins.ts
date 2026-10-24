import { sources, type Profile, type Source } from "./dialects";
export interface BuiltinSignature {
  name: string;
  parameters: { name: string; type: string }[];
  returns: string;
  source: Source;
  description: string;
}
const specs: Record<string, [string, string, string]> = {
  LENGTH: ["ThisString:STRING", "INTEGER", "Length of the string"],
  LEFT: ["ThisString:STRING,x:INTEGER", "STRING", "Leftmost x characters"],
  RIGHT: ["ThisString:STRING,x:INTEGER", "STRING", "Rightmost x characters"],
  MID: [
    "ThisString:STRING,x:INTEGER,y:INTEGER",
    "STRING",
    "y characters starting at one-based x",
  ],
  SUBSTRING: [
    "ThisString:STRING,start:INTEGER,length:INTEGER",
    "STRING",
    "One-based substring; start and length are positive",
  ],
  UCASE: ["x:CHAR", "CHAR", "Upper case"],
  LCASE: ["x:CHAR", "CHAR", "Lower case"],
  TO_UPPER: ["x:CHAR|STRING", "SAME", "Upper case, preserving argument type"],
  TO_LOWER: ["x:CHAR|STRING", "SAME", "Lower case, preserving argument type"],
  NUM_TO_STR: ["x:INTEGER|REAL", "STRING", "Numeric representation as text"],
  STR_TO_NUM: ["x:CHAR|STRING", "NUMBER", "Text representation as a number"],
  IS_NUM: [
    "ThisString:CHAR|STRING",
    "BOOLEAN",
    "Whether the text is a valid numeric value",
  ],
  ASC: ["ThisChar:CHAR", "INTEGER", "ASCII code"],
  CHR: ["x:INTEGER", "CHAR", "Character with ASCII code x"],
  INT: [
    "x:REAL",
    "INTEGER",
    "Integer part; negative behaviour follows selected policy",
  ],
  RAND: ["x:INTEGER", "REAL", "Seeded number in [0,x)"],
  RANDOM: ["", "REAL", "Seeded number in [0,1]"],
  ROUND: [
    "x:REAL,places:INTEGER",
    "NUMBER",
    "Rounded to places decimal places; tie behaviour is a policy",
  ],
  DIV: ["x:INTEGER,y:INTEGER", "INTEGER", "Integer quotient"],
  MOD: ["x:INTEGER,y:INTEGER", "INTEGER", "Remainder"],
  DAY: ["ThisDate:DATE", "INTEGER", "Day of month"],
  MONTH: ["ThisDate:DATE", "INTEGER", "Month number"],
  YEAR: ["ThisDate:DATE", "INTEGER", "Year"],
  DAYINDEX: ["ThisDate:DATE", "INTEGER", "Sunday=1 through Saturday=7"],
  SETDATE: [
    "Day:INTEGER,Month:INTEGER,Year:INTEGER",
    "DATE",
    "Construct and validate a date",
  ],
  TODAY: ["", "DATE", "Current UTC calendar date, injectable for tests"],
  EOF: ["FileName:STRING", "BOOLEAN", "End of file; requires READ mode"],
};
export function builtinSignature(
  name: string,
  p: Profile,
): BuiltinSignature | undefined {
  name = name.toUpperCase();
  if (!p.builtins.includes(name)) return;
  const spec = specs[name];
  let [args, returns, description] = spec;
  if (p.whileDo && ["UCASE", "LCASE"].includes(name)) {
    args = "x:CHAR|STRING";
    returns = "SAME";
  }
  const section = p.whileDo
    ? ["ROUND", "RANDOM"].includes(name)
      ? "p.41 / 8.1.7"
      : ["DIV", "MOD"].includes(name)
        ? "p.40 / 8.1.4(f)"
        : "p.41 / 8.1.4(e)"
    : ["UCASE", "LCASE"].includes(name)
      ? "§5.5"
      : name === "EOF"
        ? "p.4"
        : name.startsWith("DAY") ||
            [
              "MONTH",
              "YEAR",
              "SETDATE",
              "TODAY",
              "INT",
              "RAND",
              "ASC",
              "CHR",
              "IS_NUM",
            ].includes(name)
          ? "p.3"
          : "p.2";
  return {
    name,
    parameters: args
      ? args.split(",").map((x) => {
          const [name, type] = x.split(":");
          return { name, type };
        })
      : [],
    returns,
    description,
    source: {
      ...(p.whileDo
        ? p.source
        : ["UCASE", "LCASE"].includes(name)
          ? p.source
          : sources.insert),
      section,
    },
  };
}
export function signatureText(sig: BuiltinSignature) {
  return `${sig.name}(${sig.parameters.map((p) => `${p.name} : ${p.type.replace("|", " / ")}`).join(", ")}) RETURNS ${sig.returns}`;
}
