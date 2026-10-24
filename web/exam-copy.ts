import { tr } from "./i18n";
import { examRules, type ExamEnvironment } from "../core/exam";

export const examLabels: Record<string, string> = {
  本地考试练习: "Local exam practice",
  考试练习: "Exam practice",
  "本地模拟练习，不具备防作弊能力，也不代表官方考试或成绩。考试期间关闭学习辅助，规则与方言锁定。普通草稿单独保留。":
    "Timed practice with learning aids turned off and the selected dialect and rules locked. Your ordinary draft is saved separately.",
  考试方言: "Exam dialect",
  "Guide 版本": "Guide version",
  "时长（分钟）": "Duration (minutes)",
  以当前源码为起始代码: "Start with the current source",
  开始考试: "Start exam",
  剩余: "Remaining",
  提交答卷: "Submit answer",
  下载答卷: "Download answer",
  下载记录: "Download record",
  结束并恢复草稿: "Finish and restore draft",
  下载上次答卷: "Download previous answer",
  下载上次记录: "Download previous record",
  "Insert 函数与规则参考": "Insert: functions and rules",
};

const builtinDescriptions: Record<string, string> = {
  LENGTH: "字符串的长度",
  LEFT: "字符串最左侧的 x 个字符",
  RIGHT: "字符串最右侧的 x 个字符",
  MID: "从位置 x 开始的 y 个字符，位置从 1 开始",
  SUBSTRING: "截取子串；位置从 1 开始，起始位置与长度均为正整数",
  UCASE: "转为大写",
  LCASE: "转为小写",
  TO_UPPER: "转为大写，保持参数类型",
  TO_LOWER: "转为小写，保持参数类型",
  NUM_TO_STR: "将数值表示为文本",
  STR_TO_NUM: "将文本表示为数值",
  IS_NUM: "检查文本是否为有效数值",
  ASC: "字符的 ASCII 编码",
  CHR: "ASCII 编码 x 对应的字符",
  INT: "取整数部分；负数行为遵循所选策略",
  RAND: "使用随机种子生成 [0,x) 范围内的数值",
  RANDOM: "使用随机种子生成 [0,1] 范围内的数值",
  ROUND: "保留 places 位小数；中间值取舍遵循所选策略",
  DIV: "整数商",
  MOD: "余数",
  DAY: "日期中的日",
  MONTH: "月份编号",
  YEAR: "年份",
  DAYINDEX: "星期日为 1，依次至星期六为 7",
  SETDATE: "创建并验证日期",
  TODAY: "当前 UTC 日期；测试时可注入日期",
  EOF: "检查文件结尾；要求 READ 模式",
};

export function examBuiltinDescription(name: string, english: string) {
  return tr(english, builtinDescriptions[name] ?? english);
}

export function examPolicyText(config: ExamEnvironment) {
  const policies = examRules(config).policies;
  const truncate = tr("Truncate toward zero", "向零截断");
  const floor = tr("Round down", "向下取整");
  const rows: [string, string][] = [
    [
      tr("Logical precedence", "逻辑运算优先级"),
      config.logicalPrecedence === "standard"
        ? "NOT > AND > OR"
        : tr("Evaluate left to right", "从左到右计算"),
    ],
    [
      tr("DIV with negative numbers", "负数 DIV"),
      policies.divNegative === "truncate" ? truncate : floor,
    ],
    [
      tr("INT with negative numbers", "负数 INT"),
      policies.intNegative === "truncate" ? truncate : floor,
    ],
    [
      tr("ROUND ties", "ROUND 中间值"),
      policies.roundHalf === "away"
        ? tr("Away from zero", "远离零")
        : tr("To the nearest even number", "取最接近的偶数"),
    ],
    [
      tr("FOR bounds", "FOR 边界"),
      policies.forBounds === "once"
        ? tr("Evaluate once", "仅计算一次")
        : tr("Evaluate each iteration", "每次循环计算"),
    ],
    [
      tr("Short-circuit evaluation", "逻辑短路求值"),
      policies.shortCircuit ? tr("Enabled", "启用") : tr("Disabled", "关闭"),
    ],
    [
      tr("Real-number output", "实数输出"),
      policies.realOutput === "compact"
        ? tr("Compact decimal", "紧凑小数")
        : tr("Preserve decimal part", "保留小数部分"),
    ],
    [
      tr("Boolean output", "布尔值输出"),
      policies.booleanOutput === "upper" ? "TRUE / FALSE" : "true / false",
    ],
    [
      tr("File-name matching", "文件名匹配"),
      policies.filenameCase === "sensitive"
        ? tr("Case-sensitive", "区分大小写")
        : tr("Case-insensitive", "忽略大小写"),
    ],
    [tr("Step limit", "步数上限"), String(config.maxSteps)],
    [tr("Random seed", "随机种子"), String(config.seed)],
  ];
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}
