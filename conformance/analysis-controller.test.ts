import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WorkerRequestController,
  type ServiceWorker,
} from "../web/analysis-controller";

class FakeWorker implements ServiceWorker {
  onmessage: ServiceWorker["onmessage"] = null;
  onerror: ServiceWorker["onerror"] = null;
  messages: any[] = [];
  terminated = false;
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(value: object) {
    this.onmessage?.({ data: { id: this.messages.at(-1).id, ...value } });
  }
}
function setup() {
  const workers: FakeWorker[] = [];
  const states: string[] = [];
  const controller = new WorkerRequestController(
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    (state) => states.push(state.status),
  );
  return { controller, workers, states };
}
test("concurrent lint requests share analysis and completed results are reused", async () => {
  const { controller, workers } = setup();
  const job = { source: "OUTPUT 1", dialect: "0478" };
  const first = controller.request(job),
    second = controller.request(job);
  assert.equal(first, second);
  assert.equal(workers[0].messages.length, 1);
  workers[0].reply({ diagnostics: [] });
  assert.deepEqual(await first, await controller.request(job));
  assert.equal(workers[0].messages.length, 1);
});
test("new source terminates stale synchronous analysis and ignores its late reply", async () => {
  const { controller, workers } = setup();
  const stale = controller.request({ source: "old" }).catch((e) => e.name);
  const next = controller.request({ source: "new" });
  assert.equal(workers[0].terminated, true);
  workers[0].reply({ diagnostics: ["stale"] });
  workers[1].reply({ diagnostics: ["current"] });
  assert.equal(await stale, "AbortError");
  assert.deepEqual(await next, { id: 2, diagnostics: ["current"] });
});
test("cancel is immediately effective and the complete source can be reanalyzed", async () => {
  const { controller, workers, states } = setup();
  const job = { source: "OUTPUT 1\n".repeat(100000) };
  const first = controller.request(job).catch((e) => e.name);
  controller.cancel();
  assert.equal(await first, "AbortError");
  assert.equal(states.at(-1), "cancelled");
  const resumed = controller.request(job);
  assert.equal(workers[1].messages[0].source, job.source);
  workers[1].reply({ diagnostics: ["last line"] });
  assert.equal(((await resumed) as any).diagnostics[0], "last line");
});
test("idle invalidation retains worker context for incremental analysis; crashes recover", async () => {
  const { controller, workers } = setup();
  const first = controller.request({ source: "one" });
  workers[0].reply({ diagnostics: [] });
  await first;
  controller.invalidate();
  const second = controller.request({ source: "two" }).catch((e) => e.message);
  assert.equal(workers.length, 1);
  workers[0].onerror?.({ message: "worker crashed" });
  assert.equal(await second, "worker crashed");
  const third = controller.request({ source: "three" });
  workers[1].reply({ diagnostics: [] });
  await third;
  assert.equal(workers.length, 2);
});
