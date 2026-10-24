import { LanguageService } from "../core/language-service";
import { completionItems, definition, hover, rename } from "../core/language";
const service = new LanguageService();
onmessage = ({ data }) => {
  try {
    if (data.type === "query") {
      const args = [data.source, data.dialect] as const;
      const result =
        data.operation === "completion"
          ? completionItems(...args, data.position)
          : data.operation === "hover"
            ? hover(...args, data.position)
            : data.operation === "definition"
              ? definition(...args, data.name, data.line, data.column)
              : rename(
                  ...args,
                  data.name,
                  data.replacement,
                  data.line,
                  data.column,
                );
      postMessage({ id: data.id, result });
      return;
    }
    postMessage({ id: data.id, type: "progress", phase: "解析与语义检查" });
    const result = service.update(
      data.source,
      data.dialect,
      data.profileOptions,
    );
    postMessage({ id: data.id, type: "progress", phase: "整理完整诊断与大纲" });
    postMessage({
      id: data.id,
      ...result,
      outline: service.outline(),
      continuations: service.continuations(),
      signatures: service.signatures(data.profileOptions),
    });
  } catch (e: any) {
    postMessage({ id: data.id, error: e.message });
  }
};
