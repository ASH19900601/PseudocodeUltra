export type Locale = "en" | "zh-CN";

let currentLocale: Locale = "en";

export function getLocale(): Locale {
  return currentLocale;
}

export function setCoreLocale(locale: Locale) {
  currentLocale = locale === "zh-CN" ? "zh-CN" : "en";
}

export function tr(english: string, chinese: string): string {
  return currentLocale === "zh-CN" ? chinese : english;
}

// Only known application messages are translated. Source text, identifiers and
// values can contain any language and must never be stripped or rewritten.
const englishMessages: Record<string, string> = {
  "考试时长必须是 1–300 分钟的整数":
    "Exam duration must be a whole number from 1 to 300 minutes",
  无效的系统时间: "Invalid system time",
  "语言分析 Worker 失败，请重新分析。":
    "Language analysis worker failed. Run analysis again.",
  语言分析已取消: "Language analysis cancelled",
  准备文档: "Preparing document",
  解析与语义检查: "Parsing and checking types",
  整理完整诊断与大纲: "Preparing diagnostics and outline",
  未初始化: "Uninitialized",
};

export function localizeMessage(
  message: string,
  locale: Locale = currentLocale,
): string {
  if (locale === "zh-CN") return message;
  return message
    .split("\n")
    .map((line) => {
      const known = englishMessages[line];
      if (known) return known;
      // Several old bilingual templates put useful arguments only in the Chinese
      // half. Translate those templates first so no identifier or value is lost.
      const templates: Array<[RegExp, (...values: string[]) => string]> = [
        [
          /^(.+) 第 (\d+) 个参数应为 (.+) \/ Invalid argument type$/,
          (name, index, type) => `${name} argument ${index} must be ${type}`,
        ],
        [
          /^不能将 (.+) 赋给 (.+) \/ Incompatible assignment$/,
          (value, target) => `Cannot assign ${value} to ${target}`,
        ],
        [
          /^(.+) 参数数量错误 \/ Wrong argument count$/,
          (name) => `Wrong argument count for ${name}`,
        ],
        [
          /^(.+) 未以 (.+) 打开 \/ Wrong file mode$/,
          (name, mode) => `${name} is not open in ${mode} mode`,
        ],
        [
          /^此方言不支持 (.+) \/ Type unavailable$/,
          (type) => `Type unavailable in this dialect: ${type}`,
        ],
        [
          /^第 (\d+) 行缺少 (.+) \/ Missing .+$/,
          (line, end) => `Line ${line}: Missing ${end}`,
        ],
        [/^补充 (.+) \/ Insert terminator$/, (end) => `Insert ${end}`],
      ];
      for (const [pattern, translate] of templates) {
        const match = pattern.exec(line);
        if (match) return translate(...match.slice(1));
      }
      // Existing compiler messages use “Chinese / English”. Keep the complete
      // English tail, including interpolated user data and further slashes.
      const delimiter = /\s+\/\s+(?=[A-Za-z])/g;
      let match: RegExpExecArray | null;
      while ((match = delimiter.exec(line))) {
        if (/\p{Script=Han}/u.test(line.slice(0, match.index)))
          return line.slice(match.index + match[0].length);
      }
      const prefixes: [string, string][] = [
        ["此方言不支持 ", "Type unavailable in this dialect: "],
        ["未知运算符 ", "Unknown operator "],
        ["未声明循环变量 ", "Undeclared loop variable "],
      ];
      for (const [chinese, english] of prefixes)
        if (line.startsWith(chinese))
          return english + line.slice(chinese.length);
      return line;
    })
    .join("\n");
}
