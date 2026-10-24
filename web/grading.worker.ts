import { evaluatePracticeCase, practiceExercise } from "../core/practice";
import { setCoreLocale } from "../core/i18n";

// No IDE files, custom policies or ambient inputs enter the deterministic grader.
onmessage = ({ data }) => {
  if (data.type !== "case") return;
  const locale = data.locale === "zh-CN" ? "zh-CN" : "en";
  setCoreLocale(locale);
  const exercise = practiceExercise(data.exerciseId, locale);
  if (
    !exercise ||
    !Number.isInteger(data.index) ||
    !exercise.cases[data.index] ||
    typeof data.source !== "string"
  )
    return;
  postMessage({
    type: "result",
    token: data.token,
    result: evaluatePracticeCase(data.source, exercise, data.index, locale),
  });
};
postMessage({ type: "ready" });
