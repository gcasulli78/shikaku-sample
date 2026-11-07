import { type Job, runJob } from "./jobs";
import GeneratorWorker from "./worker?worker&inline";

/**
 * Works in the Worker (generates a puzzle or opens a link); if it can't be created (old browsers),
 * on the main thread. A new request cancels the one in progress: the Worker is recreated and the
 * old promise resolves with undefined. R is the result of the jobs requested from this instance.
 */
export function createRunner<R>(): (job: Job) => Promise<R | undefined> {
  let worker: Worker | undefined;
  let usable = true;
  let current: { id: number; job: Job; resolve: (r: R | undefined) => void } | undefined;
  let nextId = 0;

  const fallback = (task: NonNullable<typeof current>) => {
    // Gives the browser time to show "Generazione…" before blocking.
    setTimeout(() => task.resolve(current === task ? (runJob(task.job) as R | undefined) : undefined), 30);
  };

  const spawn = () => {
    try {
      worker = new GeneratorWorker();
    } catch {
      usable = false;
      worker = undefined;
      return;
    }
    worker.addEventListener("message", (e: MessageEvent<{ id: number; result: R | undefined }>) => {
      if (current && e.data.id === current.id) {
        const task = current;
        current = undefined;
        task.resolve(e.data.result);
      }
    });
    worker.addEventListener("error", () => {
      usable = false;
      worker?.terminate();
      worker = undefined;
      if (current) fallback(current);
    });
  };

  return (job) =>
    new Promise((resolve) => {
      if (current) {
        current.resolve(undefined);
        current = undefined;
        worker?.terminate();
        worker = undefined;
      }
      const task = { id: ++nextId, job, resolve };
      current = task;
      if (usable && !worker) spawn();
      if (worker) worker.postMessage({ id: task.id, job });
      else fallback(task);
    });
}
