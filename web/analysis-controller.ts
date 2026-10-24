// One live job per worker. Repeated lint callers share the same request, while
// edits/cancel terminate synchronous analysis instead of queuing stale documents.
export interface ServiceWorker {
  onmessage: ((event: any) => any) | null;
  onerror: ((event: any) => any) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
export interface AnalysisState {
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  phase?: string;
  startedAt: number;
}
export class WorkerRequestController {
  private worker?: ServiceWorker;
  private serial = 0;
  private active?: {
    id: number;
    key: string;
    source: string;
    promise: Promise<any>;
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    startedAt: number;
  };
  private cached?: { key: string; source: string; value: any };
  constructor(
    private factory: () => ServiceWorker,
    private onState: (state: AnalysisState) => void = () => {},
  ) {}
  request<T>(job: { source: string; [key: string]: unknown }): Promise<T> {
    const { source, ...options } = job;
    const key = JSON.stringify(options);
    if (this.active?.key === key && this.active.source === source)
      return this.active.promise;
    if (this.cached?.key === key && this.cached.source === source)
      return Promise.resolve(this.cached.value);
    this.invalidate();
    const worker = (this.worker ??= this.factory());
    const id = ++this.serial;
    let resolve!: (data: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    });
    const startedAt = Date.now();
    this.active = { id, key, source, promise, resolve, reject, startedAt };
    worker.onmessage = ({ data }) => {
      const active = this.active;
      if (!active || data.id !== active.id || this.worker !== worker) return;
      if (data.type === "progress") {
        this.onState({ status: "running", phase: data.phase, startedAt });
        return;
      }
      this.active = undefined;
      if (data.error) {
        this.onState({ status: "error", phase: data.error, startedAt });
        reject(new Error(data.error));
      } else {
        this.cached = { key, source, value: data };
        this.onState({ status: "complete", startedAt });
        resolve(data);
      }
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      this.active = undefined;
      this.worker = undefined;
      worker.terminate();
      this.onState({ status: "error", phase: event.message, startedAt });
      reject(new Error(event.message || "语言分析 Worker 失败，请重新分析。"));
    };
    this.onState({ status: "running", phase: "准备文档", startedAt });
    worker.postMessage({ ...job, id });
    return promise;
  }
  invalidate() {
    this.cached = undefined;
    if (!this.active) return;
    const { reject } = this.active;
    this.active = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    const error = new Error("语言分析已取消");
    error.name = "AbortError";
    reject(error);
  }
  cancel() {
    const startedAt = this.active?.startedAt || Date.now();
    this.invalidate();
    this.onState({ status: "cancelled", startedAt });
  }
}
