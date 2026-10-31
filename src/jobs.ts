import { type GenerateOptions, type GenerateResult, generate } from "./generator";
import { type LinkedPuzzle, puzzleFromCode } from "./share";

/** Lavoro da fare nel Worker: generare un puzzle o aprire quello di un link. */
export type Job = { generate: GenerateOptions } | { link: string };

export function runJob(job: Job): GenerateResult | LinkedPuzzle | undefined {
  return "generate" in job ? generate(job.generate) : puzzleFromCode(job.link);
}
