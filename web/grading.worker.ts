import { evaluatePracticeCase, practiceExercise } from "../core/practice";

// No IDE files, custom policies or ambient inputs enter the deterministic grader.
onmessage = ({ data }) => {
  if (data.type !== "case") return;
  const exercise = practiceExercise(data.exerciseId);
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
    result: evaluatePracticeCase(data.source, exercise, data.index),
  });
};
postMessage({ type: "ready" });
