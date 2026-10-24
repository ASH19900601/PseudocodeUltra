import { LanguageService } from "../core/language-service";
const service = new LanguageService();
onmessage = ({ data }) => {
  try {
    const result = service.update(
      data.source,
      data.dialect,
      data.profileOptions,
    );
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
