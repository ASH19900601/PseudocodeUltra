import { LanguageService } from "../core/language-service";
import { completionItems, definition, hover, rename } from "../core/language";
import { localizeMessage, setCoreLocale, tr } from "../core/i18n";
const service = new LanguageService();
onmessage = ({ data }) => {
  setCoreLocale(data.locale === "zh-CN" ? "zh-CN" : "en");
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
      postMessage({
        id: data.id,
        result:
          data.operation === "hover" && typeof result === "string"
            ? localizeMessage(result)
            : data.operation === "completion" && Array.isArray(result)
              ? result.map((item: any) => ({
                  ...item,
                  info: localizeMessage(item.info),
                }))
              : result,
      });
      return;
    }
    postMessage({
      id: data.id,
      type: "progress",
      phase: tr("Parsing and checking types", "解析与语义检查"),
    });
    const result = service.update(
      data.source,
      data.dialect,
      data.profileOptions,
    );
    postMessage({
      id: data.id,
      type: "progress",
      phase: tr("Preparing diagnostics and outline", "整理完整诊断与大纲"),
    });
    postMessage({
      id: data.id,
      ...result,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        rawMessage: diagnostic.message,
        message: localizeMessage(diagnostic.message),
        actions: diagnostic.actions?.map((action) => ({
          ...action,
          rawName: action.name,
          name: localizeMessage(action.name),
        })),
      })),
      outline: service.outline(),
      continuations: service.continuations(),
      signatures: service.signatures(data.profileOptions),
    });
  } catch (e: any) {
    postMessage({
      id: data.id,
      error: localizeMessage(e.message),
      rawMessage: e.message,
    });
  }
};
