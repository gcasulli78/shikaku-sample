// Genera i puzzle fuori dal thread della pagina, così l'interfaccia resta reattiva.
import { generate, type GenerateOptions } from "./generator";

self.onmessage = (e: MessageEvent<{ id: number; options: GenerateOptions }>) => {
  self.postMessage({ id: e.data.id, result: generate(e.data.options) });
};
