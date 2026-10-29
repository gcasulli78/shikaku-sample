// Genera i puzzle e apre i link fuori dal thread della pagina, così l'interfaccia resta reattiva.
import { runJob, type Job } from "./jobs";

self.onmessage = (e: MessageEvent<{ id: number; job: Job }>) => {
  self.postMessage({ id: e.data.id, result: runJob(e.data.job) });
};
