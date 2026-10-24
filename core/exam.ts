import { profile, type DialectId, type Strictness } from "./dialects";
import { defaultPolicies, type RuntimePolicies } from "./policies";

export type ExamGuideVersion = "2026" | "2027–2029";
export interface ExamEnvironment {
  dialect: DialectId;
  guideVersion: ExamGuideVersion;
  strictness: Strictness;
  styleChecks: boolean;
  logicalPrecedence: "standard" | "leftToRight";
  policies: RuntimePolicies;
  maxSteps: number;
  seed: number;
  runMode: "manual" | "change" | "blur";
  fastMode: boolean;
  sourceName: string;
}
export interface ExamSession {
  format: "pseudocode-ultra-exam";
  version: 1;
  id: string;
  status: "running" | "submitted" | "expired" | "ended";
  startedAt: number;
  deadline: number;
  completedAt?: number;
  savedAt: number;
  answer: string;
  config: ExamEnvironment;
  normalSource: string;
  normalConfig: ExamEnvironment;
}
export interface ExamStartOptions {
  dialect: DialectId;
  guideVersion: ExamGuideVersion;
  minutes: number;
  initialSource?: string;
}
export const EXAM_SESSION_KEY = "pseudocode-ultra-exam-v1";
export const EXAM_ARCHIVE_KEY = "pseudocode-ultra-exam-last-v1";

const dialects: readonly string[] = ["0478", "2210", "9618-AS", "9618-A2"];
const guides: readonly string[] = ["2026", "2027–2029"];
export function validConfig(value: any): value is ExamEnvironment {
  if (!value || typeof value !== "object") return false;
  if (
    !dialects.includes(value.dialect) ||
    !guides.includes(value.guideVersion) ||
    !["exam", "learning", "lenient"].includes(value.strictness) ||
    typeof value.styleChecks !== "boolean" ||
    !["standard", "leftToRight"].includes(value.logicalPrecedence) ||
    !["manual", "change", "blur"].includes(value.runMode) ||
    typeof value.fastMode !== "boolean" ||
    typeof value.sourceName !== "string" ||
    !Number.isInteger(value.maxSteps) ||
    value.maxSteps < 1 ||
    value.maxSteps > 1e9 ||
    !Number.isInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 4294967295 ||
    !value.policies ||
    typeof value.policies !== "object"
  )
    return false;
  const choices: {
    [K in keyof RuntimePolicies]: readonly RuntimePolicies[K][];
  } = {
    divNegative: ["truncate", "floor"],
    intNegative: ["truncate", "floor"],
    roundHalf: ["away", "even"],
    forBounds: ["once", "eachIteration"],
    shortCircuit: [true, false],
    realOutput: ["compact", "preserve"],
    booleanOutput: ["upper", "lower"],
    filenameCase: ["sensitive", "insensitive"],
  };
  return Object.entries(choices).every(([key, allowed]) =>
    (allowed as unknown[]).includes(value.policies[key]),
  );
}
export function parseExamSession(source: string | null): ExamSession | null {
  try {
    const value = JSON.parse(source || "null");
    if (
      !value ||
      value.format !== "pseudocode-ultra-exam" ||
      value.version !== 1 ||
      typeof value.id !== "string" ||
      !["running", "submitted", "expired", "ended"].includes(value.status) ||
      typeof value.answer !== "string" ||
      typeof value.normalSource !== "string" ||
      !validConfig(value.config) ||
      !validConfig(value.normalConfig) ||
      !Number.isFinite(value.startedAt) ||
      !Number.isFinite(value.deadline) ||
      value.deadline <= value.startedAt ||
      !Number.isFinite(value.savedAt) ||
      (value.completedAt !== undefined && !Number.isFinite(value.completedAt))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function startExam(
  normalSource: string,
  normalConfig: ExamEnvironment,
  options: ExamStartOptions,
  now: number,
): ExamSession {
  if (
    !validConfig(normalConfig) ||
    !dialects.includes(options.dialect) ||
    !guides.includes(options.guideVersion)
  )
    throw new Error("无效的考试配置 / Invalid exam configuration");
  if (
    !Number.isInteger(options.minutes) ||
    options.minutes < 1 ||
    options.minutes > 300
  )
    throw new Error("考试时长必须是 1–300 分钟的整数");
  if (!Number.isFinite(now)) throw new Error("无效的系统时间");
  const config: ExamEnvironment = {
    ...structuredClone(normalConfig),
    dialect: options.dialect,
    guideVersion: options.guideVersion,
    strictness: "exam",
    styleChecks: false,
    runMode: "manual",
    fastMode: false,
    sourceName: "exam-answer.pseudo",
  };
  return {
    format: "pseudocode-ultra-exam",
    version: 1,
    id: `exam-${Math.trunc(now)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "running",
    startedAt: now,
    deadline: now + options.minutes * 60000,
    savedAt: now,
    answer: options.initialSource ?? "",
    config,
    normalSource,
    normalConfig: structuredClone(normalConfig),
  };
}
export function expireExam(session: ExamSession, now: number): ExamSession {
  return session.status === "running" && now >= session.deadline
    ? {
        ...session,
        status: "expired",
        completedAt: session.deadline,
        savedAt: now,
      }
    : session;
}
export function submitExam(session: ExamSession, now: number): ExamSession {
  session = expireExam(session, now);
  return session.status === "running"
    ? { ...session, status: "submitted", completedAt: now, savedAt: now }
    : session;
}
export function examClock(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function examRules(config: ExamEnvironment) {
  const p = profile(config.dialect, { guideVersion: config.guideVersion });
  return {
    label: `${config.dialect} · ${p.version}`,
    profile: p,
    policies: { ...defaultPolicies, ...config.policies },
  };
}
// Ordinary drafts and previous settings are intentionally absent from the export.
export function exportExamAnswer(session: ExamSession) {
  return JSON.stringify(
    {
      format: "pseudocode-ultra-exam-answer",
      version: 1,
      id: session.id,
      status: session.status,
      startedAt: new Date(session.startedAt).toISOString(),
      deadline: new Date(session.deadline).toISOString(),
      completedAt:
        session.completedAt === undefined
          ? null
          : new Date(session.completedAt).toISOString(),
      rules: examRules(session.config).label,
      config: session.config,
      answer: session.answer,
      notice: "本地模拟练习记录，可由使用者修改；不是官方成绩或防作弊证明。",
    },
    null,
    2,
  );
}
