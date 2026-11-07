// Generates puzzles and opens links off the page thread, so the UI stays responsive.
import { type Job, runJob } from "./jobs";

self.onmessage = (e: MessageEvent<{ id: number; job: Job }>) => {
  self.postMessage({ id: e.data.id, result: runJob(e.data.job) });
};
