import type { DialectId } from "./dialects";
import { Machine } from "./runtime";
import { getLocale, localizeMessage, type Locale } from "./i18n";
import { practiceEnglish } from "./practice.en";

export interface PracticeCase {
  input: string[];
  output: string[];
  public: boolean;
  points: number;
  criterion: string;
  advice: string;
}
export interface PracticeExercise {
  id: string;
  title: string;
  dialect: DialectId;
  minutes: number;
  topics: string[];
  statement: string;
  inputContract: string;
  outputContract: string;
  starter: string;
  cases: PracticeCase[];
}
const c = (
  input: (string | number)[],
  output: (string | number)[],
  criterion: string,
  advice: string,
  visible = false,
): PracticeCase => ({
  input: input.map(String),
  output: output.map(String),
  criterion,
  advice,
  public: visible,
  points: 20,
});

/** Original exercises. Client-side checks support practice; they are not secret or an exam security boundary. */
export const practiceExercises: PracticeExercise[] = [
  {
    id: "sum-two",
    title: "01 · 两次配送的总件数",
    dialect: "0478",
    minutes: 5,
    topics: ["输入输出", "整数运算"],
    statement:
      "仓库用两个有符号整数记录两次库存变动。计算合计变动量。负数表示出库。",
    inputContract:
      "依次 INPUT 两个 INTEGER，每个范围为 -1000 到 1000，每次 INPUT 读取一行。",
    outputContract:
      "只 OUTPUT 一行整数，表示两个输入之和。不要输出输入提示语。",
    starter:
      "// TODO: 读取两次库存变动，输出总量\nDECLARE First, Second : INTEGER\nINPUT First\nINPUT Second\n// TODO: 计算并输出\n",
    cases: [
      c([7, 5], [12], "正数相加", "检查两个输入是否都参与加法。", true),
      c([-3, 8], [5], "正负混合", "负库存变化也需要参与相加。", true),
      c([0, 0], [0], "零值", "零的结果也需要输出。"),
      c(
        [-1000, -1000],
        [-2000],
        "负数与下界",
        "合计结果可以小于单个输入的下界。",
      ),
      c([1000, -1000], [0], "相互抵消", "不要用绝对值代替有符号加法。"),
    ],
  },
  {
    id: "temperature",
    title: "02 · 温室温度分区",
    dialect: "0478",
    minutes: 8,
    topics: ["IF", "边界条件"],
    statement:
      "温室传感器按温度输出标签：温度不大于 0 为 FREEZING；大于 0 且小于 30 为 MILD；至少 30 为 HOT。",
    inputContract: "INPUT 一个 -50 到 100 的 INTEGER 温度。",
    outputContract: "只输出一行大写标签 FREEZING、MILD 或 HOT。",
    starter:
      "DECLARE Temperature : INTEGER\nINPUT Temperature\n// TODO: 按三个区间输出对应标签\n",
    cases: [
      c([-8], ["FREEZING"], "低温区间", "不大于 0 的温度属于 FREEZING。", true),
      c([18], ["MILD"], "中间区间", "中间区间需要同时满足两个边界。", true),
      c([0], ["FREEZING"], "零度边界", "检查 0 属于哪一个区间。"),
      c([29], ["MILD"], "高温前一度", "29 仍应属于中间区间。"),
      c([30], ["HOT"], "三十度边界", "检查 30 是否被包含在 HOT 中。"),
    ],
  },
  {
    id: "staircase",
    title: "03 · 楼梯亮灯总数",
    dialect: "0478",
    minutes: 8,
    topics: ["FOR", "累加器"],
    statement:
      "第 1 层亮 1 盏灯，第 2 层亮 2 盏，依此类推到第 N 层。计算总亮灯数；N = 0 表示没有楼层。可以使用任何等价算法。",
    inputContract: "INPUT 一个 0 到 1000 的 INTEGER N。",
    outputContract: "只输出一行整数，表示从 1 加到 N 的和；N = 0 时输出 0。",
    starter:
      "DECLARE N, Total, Level : INTEGER\nINPUT N\n// TODO: 求总亮灯数（注意 N = 0）\n",
    cases: [
      c([4], [10], "普通楼层", "累加每层数量，并在最后输出。", true),
      c([1], [1], "单层", "循环起点应包含第一层。", true),
      c([0], [0], "无楼层", "先初始化累加器；零次循环也要有结果。"),
      c([2], [3], "末层包含", "循环应包含第 N 层。"),
      c([1000], [500500], "输入上界", "总数可能远大于 N。"),
    ],
  },
  {
    id: "array-stats",
    title: "04 · 五日净增统计",
    dialect: "0478",
    minutes: 12,
    topics: ["一维数组", "最大值", "计数"],
    statement:
      "读取连续五日的净增量，找出其中最大值，并统计严格大于 0 的天数。建议用数组保存五个输入。",
    inputContract: "连续 INPUT 五个 -100 到 100 的 INTEGER，按天数顺序读取。",
    outputContract:
      "输出两行：第一行为五个数的最大值；第二行为严格正数的个数。0 不计入正数。",
    starter:
      "DECLARE Values : ARRAY[1:5] OF INTEGER\nDECLARE I, Highest, PositiveCount : INTEGER\nFOR I ← 1 TO 5\n    INPUT Values[I]\nNEXT I\n// TODO: 计算最大值及正数个数，分两行输出\n",
    cases: [
      c(
        [2, -1, 8, 0, 3],
        [8, 3],
        "混合输入",
        "最大值和正数个数需要独立维护。",
        true,
      ),
      c(
        [-8, -3, -9, -4, -7],
        [-3, 0],
        "全为负数",
        "最大值不能直接初始化为 0。",
        true,
      ),
      c([0, 0, 0, 0, 0], [0, 0], "零不算正数", "计数条件应为严格大于 0。"),
      c([100, 2, 3, 4, -100], [100, 4], "首项最大", "统计范围需包含第一项。"),
      c(
        [-1, -2, -3, -4, 100],
        [100, 1],
        "末项最大",
        "检查数组循环上界是否包含第五项。",
      ),
    ],
  },
  {
    id: "sentinel",
    title: "05 · 收款流水结束标记",
    dialect: "0478",
    minutes: 12,
    topics: ["WHILE / REPEAT", "哨兵值"],
    statement:
      "依次读取收款金额，遇到 -1 表示结束。统计有效收款笔数与总金额；-1 不参与统计，0 是一笔有效收款。",
    inputContract:
      "逐行 INPUT 0 到 100 的 INTEGER，最后一行为 -1。最多 20 笔有效收款，也可能立即结束。",
    outputContract:
      "输出两行整数：第一行有效笔数，第二行总金额。不输出结束标记。",
    starter:
      "DECLARE Amount, Count, Total : INTEGER\n// TODO: 初始化统计量，读取到 -1 为止\n// TODO: 分两行输出笔数及金额\n",
    cases: [
      c([4, 7, -1], [2, 11], "一般流水", "结束标记不应被加入金额。", true),
      c([-1], [0, 0], "立即结束", "输入第一笔前也要初始化计数与总额。", true),
      c([0, -1], [1, 0], "零金额有效", "只有 -1 是结束标记。"),
      c(
        [100, 0, 100, -1],
        [3, 200],
        "重复与上界",
        "重复金额也属于不同的有效收款。",
      ),
      c(
        [...Array(20).fill(1), -1],
        [20, 20],
        "较长流水",
        "不要用固定的少量 INPUT 代替结束判断。",
      ),
    ],
  },
  {
    id: "vowels",
    title: "06 · 标签中的元音",
    dialect: "0478",
    minutes: 12,
    topics: ["字符串", "SUBSTRING", "循环"],
    statement:
      "统计字符串中小写元音 a、e、i、o、u 的总出现次数。输入只包含小写英文字母，也可能为空串。",
    inputContract:
      "INPUT 一行 STRING，长度为 0 到 40。空行就是空串，不是缺少输入。",
    outputContract: "输出一行整数，表示元音出现次数。每次重复出现都计数。",
    starter:
      "DECLARE Label : STRING\nDECLARE I, Count : INTEGER\nINPUT Label\n// TODO: 检查每个字符，输出小写元音次数\n",
    cases: [
      c(["hello"], [2], "一般字符串", "逐个检查字符串中的字符。", true),
      c(["sky"], [0], "没有元音", "没有匹配时也要输出 0。", true),
      c([""], [0], "空串", "空串应执行零次字符检查。"),
      c(["aeiouaeiou"], [10], "重复元音", "统计出现次数，而不是不同元音种类。"),
      c(
        ["a" + "b".repeat(38) + "u"],
        [2],
        "首尾字符",
        "字符串下标从 1 开始，并包含最后一个字符。",
      ),
    ],
  },
  {
    id: "first-search",
    title: "07 · 首次出现的位置",
    dialect: "9618-AS",
    minutes: 12,
    topics: ["线性查找", "重复值", "数组"],
    statement:
      "在六个整数中查找目标值。找到时输出第一次出现的位置，位置从 1 开始；没有找到时输出 0。",
    inputContract:
      "先 INPUT 一个目标 INTEGER，再依次 INPUT 六个 INTEGER。所有数范围为 -20 到 20。",
    outputContract:
      "只输出一行整数，结果只能为 0 到 6。重复匹配时返回最早的位置。",
    starter:
      "DECLARE Target, I, Position : INTEGER\nDECLARE Values : ARRAY[1:6] OF INTEGER\nINPUT Target\nFOR I ← 1 TO 6\n   INPUT Values[I]\nNEXT I\n// TODO: 查找首次位置或输出 0\n",
    cases: [
      c(
        [3, 8, 3, 1, 3, 2, 5],
        [2],
        "首次而非末次",
        "找到后不要用较晚的位置覆盖首次位置。",
        true,
      ),
      c(
        [9, 1, 2, 3, 4, 5, 6],
        [0],
        "未找到",
        "先设置未找到结果，并且最终只输出一次。",
        true,
      ),
      c(
        [-20, -20, 0, 1, 2, 3, 4],
        [1],
        "第一项",
        "查找范围必须从位置 1 开始。",
      ),
      c([20, 1, 2, 3, 4, 5, 20], [6], "最后一项", "查找范围应包含位置 6。"),
      c(
        [0, 0, 0, 0, 0, 0, 0],
        [1],
        "全部匹配",
        "即使所有项都匹配，也只输出首次位置。",
      ),
    ],
  },
  {
    id: "digit-sum",
    title: "08 · 号码的数字和",
    dialect: "9618-AS",
    minutes: 15,
    topics: ["子程序", "DIV / MOD", "返回值"],
    statement:
      "读取一个非负整数，输出它的各位数字之和。建议提取 DigitSum 函数；判分接受所有满足输入输出契约的等价实现。",
    inputContract:
      "INPUT 一个 0 到 99999 的 INTEGER Number。输入没有前导零（数字 0 除外）。",
    outputContract: "输出一行整数，表示各十进制数字之和；Number = 0 时输出 0。",
    starter:
      "// 建议实现 FUNCTION DigitSum(N : INTEGER) RETURNS INTEGER\n// TODO: 用 DIV 和 MOD 提取数字\nDECLARE Number : INTEGER\nINPUT Number\n// TODO: 输出数字和\n",
    cases: [
      c([2047], [13], "多位数字", "每一位都应贡献到总和。", true),
      c([0], [0], "零", "为零的输入也需要输出结果。", true),
      c([9], [9], "单个数字", "循环不能漏掉最后一位。"),
      c([10000], [1], "中间有零", "用整数 DIV 更新数字，MOD 取得个位。"),
      c([99999], [45], "最大五位数", "不要限制成固定四位或把数字当作字符码。"),
    ],
  },
  {
    id: "matrix-columns",
    title: "09 · 两站三时段客流",
    dialect: "9618-AS",
    minutes: 15,
    topics: ["二维数组", "嵌套循环"],
    statement:
      "客流表有两行（车站）和三列（时段）。计算每个时段两个车站的客流总和，按时段顺序输出。",
    inputContract:
      "INPUT 六个 0 到 1000 的 INTEGER，按行读取：站 1 的三个时段，再读取站 2 的三个时段。",
    outputContract: "输出三行整数：时段 1、时段 2、时段 3 的列总和，各占一行。",
    starter:
      "DECLARE Traffic : ARRAY[1:2,1:3] OF INTEGER\nDECLARE Station, Slot, Total : INTEGER\nFOR Station ← 1 TO 2\n   FOR Slot ← 1 TO 3\n      INPUT Traffic[Station, Slot]\n   NEXT Slot\nNEXT Station\n// TODO: 按列求和，输出三行\n",
    cases: [
      c(
        [1, 2, 3, 4, 5, 6],
        [5, 7, 9],
        "列和",
        "外层按时段输出，内层合并两个车站。",
        true,
      ),
      c(
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0],
        "全零表",
        "每个时段都需要输出，包含零。",
        true,
      ),
      c(
        [1000, 0, 0, 0, 0, 1000],
        [1000, 0, 1000],
        "角落数据",
        "检查二维下标和行读取顺序。",
      ),
      c(
        [1, 10, 100, 2, 20, 200],
        [3, 30, 300],
        "列之间独立",
        "每计算一列前要把总量归零。",
      ),
      c(
        [1000, 1000, 1000, 1000, 1000, 1000],
        [2000, 2000, 2000],
        "累加上界",
        "列总量的范围可超过单格输入范围。",
      ),
    ],
  },
  {
    id: "record-winner",
    title: "10 · 社团最佳成绩",
    dialect: "9618-AS",
    minutes: 18,
    topics: ["记录", "数组", "并列规则"],
    statement:
      "读取三位成员的名字和成绩，输出最高分成员的名字。最高分并列时保留输入顺序最早的一位。建议用记录保存姓名和成绩。",
    inputContract:
      "依次 INPUT 名字、成绩，共三组（六行）。名字为 1 到 12 个英文字母组成的 STRING；成绩为 0 到 100 的 INTEGER。",
    outputContract: "只输出一行获胜者名字，大小写与输入完全一致。",
    starter:
      "TYPE Member\n   DECLARE Name : STRING\n   DECLARE Score : INTEGER\nENDTYPE\nDECLARE Members : ARRAY[1:3] OF Member\nDECLARE I, Best : INTEGER\nFOR I ← 1 TO 3\n   INPUT Members[I].Name\n   INPUT Members[I].Score\nNEXT I\n// TODO: 找出最高分并按并列规则输出名字\n",
    cases: [
      c(
        ["Amy", 70, "Bo", 92, "Chen", 80],
        ["Bo"],
        "中间最高",
        "姓名应和对应的成绩一起保存。",
        true,
      ),
      c(
        ["First", 90, "Second", 90, "Third", 20],
        ["First"],
        "并列保留最早",
        "只有严格更高的分数才更新最佳位置。",
        true,
      ),
      c(
        ["A", 0, "B", 0, "C", 0],
        ["A"],
        "全零成绩",
        "先使用第一位作为候选，不要让最佳位置无效。",
      ),
      c(
        ["CaseName", 100, "low", 1, "last", 99],
        ["CaseName"],
        "首项与大小写",
        "输出姓名时保持原始大小写。",
      ),
      c(
        ["a", 1, "b", 2, "Winner", 100],
        ["Winner"],
        "最后一项",
        "检查循环是否包含第三位成员。",
      ),
    ],
  },
];

export const PRACTICE_LIMITS = {
  source: 200000,
  steps: 50000,
  outputs: 100,
  outputCharacters: 16000,
  wallMs: 4000,
} as const;
export interface PracticeCaseResult {
  index: number;
  passed: boolean;
  score: number;
  maxScore: number;
  feedback: string;
  code?: string;
  line?: number;
  /** Only public sample output is sent to the view. */
  actual?: string[];
  /** Public-case execution details, retained verbatim for localization on display. */
  detail?: string;
}
const englishPracticeExercises = practiceExercises.map((exercise) => {
  const copy = practiceEnglish[exercise.id];
  return {
    ...exercise,
    ...copy,
    cases: exercise.cases.map((check, index) => ({
      ...check,
      ...copy.cases[index],
    })),
  };
});

export function getPracticeExercises(
  locale: Locale = getLocale(),
): PracticeExercise[] {
  return locale === "zh-CN" ? practiceExercises : englishPracticeExercises;
}

export function practiceExercise(id: string, locale: Locale = getLocale()) {
  return getPracticeExercises(locale).find((item) => item.id === id);
}

/** Rebuild feedback from result data so saved submissions follow the display language. */
export function practiceResultFeedback(
  result: PracticeCaseResult,
  exercise: PracticeExercise,
  locale: Locale = getLocale(),
): string {
  const check =
    practiceExercise(exercise.id, locale)?.cases[result.index] ||
    exercise.cases[result.index];
  const text = (english: string, chinese: string) =>
    locale === "zh-CN" ? chinese : english;
  if (!check) return localizeMessage(result.feedback, locale);
  if (result.passed)
    return text(`${check.criterion}: passed.`, `${check.criterion}：通过。`);
  if (result.code === "TIMEOUT")
    return text(
      "Execution exceeded 4 seconds and the worker was stopped. Check loops or simplify the program.",
      "执行超过 4 秒，已终止 Worker。请检查循环或简化程序。",
    );
  if (result.code === "NOT_RUN")
    return text(
      "This test was skipped after the previous test timed out. Revise the program and submit again.",
      "因前一测试超时，本测试未执行；修正后重新提交。",
    );
  if (result.code === "INPUT_UNUSED")
    return text(
      `The program did not read all required inputs. ${check.advice}`,
      `未读取题目要求的全部输入。${check.advice}`,
    );
  if (!result.code)
    return text(
      `${check.criterion}: output does not meet the contract. ${check.advice}`,
      `${check.criterion}：输出未符合契约。${check.advice}`,
    );
  const known: Record<string, [string, string]> = {
    SOURCE_LIMIT: [
      "Practice grading accepts up to 200,000 source characters. Shorten the answer.",
      "练习判分只接受 200,000 字符以内的源码；请缩短答卷。",
    ],
    INPUT_EXCESS: [
      "The program requested more input than the exercise contract provides.",
      "程序请求了题目契约以外的额外输入。",
    ],
    OUTPUT_LIMIT: [
      "The program produced too much output. Check loop termination and output placement.",
      "程序输出过多；请检查循环终止条件和输出位置。",
    ],
  };
  const knownDetail = known[result.code];
  const original =
    result.detail || result.feedback.replace(/^(?:第 \d+ 行：|Line \d+: )/, "");
  const executionSummary = text(
    `${check.criterion}: execution failed (${result.code}). ${check.advice}`,
    `${check.criterion}：执行失败（${result.code}）。${check.advice}`,
  );
  const publicDetail = localizeMessage(
    original || text("Unable to execute answer", "无法执行答卷"),
    locale,
  );
  const detail = check.public
    ? knownDetail
      ? text(...knownDetail)
      : locale === "en" && /\p{Script=Han}/u.test(publicDetail)
        ? executionSummary
        : publicDetail
    : executionSummary;
  return `${result.line ? text(`Line ${result.line}: `, `第 ${result.line} 行：`) : ""}${detail}`;
}
export function normalizePracticeOutput(lines: string[]) {
  return lines
    .flatMap((line) => line.replace(/\r\n?/g, "\n").split("\n"))
    .map((line) => line.replace(/[ \t]+$/g, ""));
}

/** Runs one case without retaining trace snapshots. A supervising browser Worker enforces wall-clock termination. */
export function evaluatePracticeCase(
  source: string,
  exercise: PracticeExercise,
  index: number,
  locale: Locale = getLocale(),
): PracticeCaseResult {
  const check = exercise.cases[index];
  const complete = (result: PracticeCaseResult) => ({
    ...result,
    feedback: practiceResultFeedback(result, exercise, locale),
  });
  if (!check)
    throw new Error(
      locale === "zh-CN" ? "不存在的练习测试" : "Practice test does not exist",
    );
  const base = { index, score: 0, maxScore: check.points, passed: false };
  let output: string[] = [],
    consumed = 0,
    characters = 0;
  try {
    if (source.length > PRACTICE_LIMITS.source)
      throw Object.assign(
        new Error("练习判分只接受 200,000 字符以内的源码；请缩短答卷。"),
        { code: "SOURCE_LIMIT" },
      );
    const machine = new Machine(source, exercise.dialect, {
      maxSteps: PRACTICE_LIMITS.steps,
      maxDepth: 64,
      fast: true,
      trace: false,
      seed: 123456789,
      clock: "2026-01-01",
      profileOptions: {
        strictness: "exam",
        guideVersion: "2026",
        styleChecks: false,
      },
    });
    let next = machine.generator.next();
    while (!next.done) {
      const event = next.value;
      if (event.kind === "input") {
        if (consumed >= check.input.length)
          throw Object.assign(new Error("程序请求了题目契约以外的额外输入。"), {
            code: "INPUT_EXCESS",
            line: event.line,
          });
        next = machine.generator.next(check.input[consumed++]);
      } else {
        if (event.kind === "output") {
          const value = event.text || "";
          characters += value.length;
          if (
            output.length >= PRACTICE_LIMITS.outputs ||
            characters > PRACTICE_LIMITS.outputCharacters
          )
            throw Object.assign(
              new Error("程序输出过多；请检查循环终止条件和输出位置。"),
              { code: "OUTPUT_LIMIT", line: event.line },
            );
          output.push(value);
        }
        next = machine.generator.next();
      }
    }
    if (consumed !== check.input.length)
      return complete({
        ...base,
        code: "INPUT_UNUSED",
        feedback: `未读取题目要求的全部输入。${check.advice}`,
        ...(check.public ? { actual: output } : {}),
      });
    const actual = normalizePracticeOutput(output),
      expected = normalizePracticeOutput(check.output);
    const passed =
      actual.length === expected.length &&
      actual.every((value, i) => value === expected[i]);
    return complete({
      ...base,
      passed,
      score: passed ? check.points : 0,
      feedback: passed
        ? `${check.criterion}：通过。`
        : `${check.criterion}：输出未符合契约。${check.advice}`,
      ...(check.public ? { actual: output } : {}),
    });
  } catch (error) {
    const e = error as { code?: string; message?: string; line?: number };
    const detail = check.public
      ? e.message || "无法执行答卷"
      : `${check.criterion}：执行失败（${e.code || "RUNTIME"}）。${check.advice}`;
    return complete({
      ...base,
      code: e.code || "RUNTIME",
      line: e.line,
      feedback: `${e.line ? `第 ${e.line} 行：` : ""}${detail}`,
      ...(check.public ? { actual: output, detail: e.message } : {}),
    });
  }
}
