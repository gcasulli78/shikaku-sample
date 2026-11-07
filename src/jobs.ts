import { type GenerateOptions, type GenerateResult, generate } from "./generator";
import { type LinkedPuzzle, puzzleFromCode } from "./share";

/** Work to do in the Worker: generate a puzzle or open the one from a link. */
export type Job = { generate: GenerateOptions } | { link: string };

export function runJob(job: Job): GenerateResult | LinkedPuzzle | undefined {
  return "generate" in job ? generate(job.generate) : puzzleFromCode(job.link);
}
