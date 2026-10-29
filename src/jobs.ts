import { generate, type GenerateOptions, type GenerateResult } from "./generator";
import { puzzleFromCode, type LinkedPuzzle } from "./share";

/** Lavoro da fare nel Worker: generare un puzzle o aprire quello di un link. */
export type Job = { generate: GenerateOptions } | { link: string };

export function runJob(job: Job): GenerateResult | LinkedPuzzle | undefined {
  return "generate" in job ? generate(job.generate) : puzzleFromCode(job.link);
}
