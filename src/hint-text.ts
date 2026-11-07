/**
 * The hint's words, without DOM: what the clues are called ("il 6 verde"), the sentences of each
 * step and the explanation steps with what to highlight. ui.ts draws them.
 */
import type { Hint, Reason, WrongReason } from "./game";
import { area, type Clue, type Rect, type Shape } from "./types";

/**
 * Name in words of a pill's hue (see HUES): in hints "il 6 verde" tells two 6s apart better than
 * "l'altro 6" (reported by the user: it wasn't clear which one).
 */
export const HUE_NAMES: Record<number, string> = {
  25: "rosso",
  55: "arancione",
  95: "giallo",
  150: "verde",
  195: "verde acqua",
  250: "blu",
  285: "indaco",
  320: "viola",
};

export type Prep = "" | "di" | "a";

/** What a clue is called in sentences: with the article and, if the pill is colored, the color. */
export type Namer = (clue: Clue, prep?: Prep) => string;

/**
 * The clue with the article, plain or with di/a: "il 6 verde", "dell'8", "all'indizio blu". Numbers
 * read starting with a vowel get an apostrophe (uno, otto, undici, ottanta…). No shape name ("il 2
 * non quadrato" sounded odd): the color is enough.
 */
export function clueName(clue: Clue, prep: Prep = "", color?: string): string {
  const { n } = clue;
  const noun = n !== undefined ? String(n) : clue.shape ? "indizio" : "?";
  const vowel = n === undefined ? noun === "indizio" : n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89);
  const article = vowel ? { "": "l'", di: "dell'", a: "all'" }[prep] : { "": "il ", di: "del ", a: "al " }[prep];
  return `${article}${noun}${color ? ` ${color}` : ""}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Summary of the reason when the piece is placed. */
export function reasonText(reason: Reason | undefined, name: Namer): string {
  if (!reason) return "Nessuna deduzione semplice da qui: ecco un pezzo della soluzione.";
  if (reason.kind === "single") return `${capitalize(name(reason.clue))} può stare solo così.`;
  if (reason.only) return `Solo ${name(reason.clue)} arriva alla casella segnata: ecco come.`;
  return `Le altre forme ${name(reason.clue, "di")} creavano un problema: resta questa.`;
}

/**
 * One step of the explanation: the sentence and what is shown. ghost: the shape being tried (dashed
 * in its clue's hue); chain: the pieces that would become forced, each in its clue's hue; marks:
 * the marked cells the sentence talks about; subject: the clue it talks about, circled; problems:
 * the problem, the only thing in red.
 */
export interface Frame {
  text: string;
  ghost?: { rect: Rect; clue: Clue };
  chain: { rect: Rect; clue: Clue }[];
  marks: { r: number; c: number }[];
  subject?: Clue;
  problems: { r: number; c: number }[];
}

/** Another clue in the explanation: "l'altro 4 verde" if it has the same name as the one being looked at. */
export function otherName(clue: Clue, focus: Clue, name: Namer): string {
  const own = name(clue);
  return clue !== focus && own === name(focus) ? `l'altro ${own.replace(/^(il |l')/, "")}` : own;
}

/**
 * The explanation in steps, one thing at a time (reported by the user: everything in one sentence
 * with everything drawn together couldn't be followed). For each discarded shape: the shape is
 * tried ("Proviamo il 2 verde qui, nel tratteggio"), then one step for each piece that becomes
 * forced, then the problem. The figures accumulate: in the problem step the whole chain is visible.
 * At the end, the conclusion. Only one clue is looked at and everything can be verified on the
 * grid.
 */
export function explainFrames(reason: Reason, name: Namer): Frame[] {
  const focus = reason.clue;
  const Focus = capitalize(name(focus));
  if (reason.kind === "single") {
    return [
      {
        text: `${Focus} può stare in un solo modo: le altre forme toccherebbero altri numeri o pezzi.`,
        chain: [],
        marks: [],
        subject: focus,
        problems: [],
      },
    ];
  }
  if (reason.only) {
    const many = reason.discards.length > 1 ? "le altre sue forme non ci arrivano" : "l'altra sua forma non ci arriva";
    return [
      {
        text: `La casella segnata può raggiungerla solo ${name(focus)}, e ${many}.`,
        chain: [],
        marks: [reason.only],
        subject: focus,
        problems: [],
      },
    ];
  }
  const total = reason.discards.length;
  const frames: Frame[] = [];
  reason.discards.forEach(({ rect, forced, problem }, k) => {
    const count = total > 1 ? `(${k + 1}/${total}) ` : "";
    const ghost = { rect, clue: focus };
    frames.push({
      text: `${count}Proviamo ${name(focus)} qui, nel tratteggio.`,
      ghost,
      chain: [],
      marks: [],
      subject: focus,
      problems: [],
    });
    forced.forEach((f, n) => {
      const who = otherName(f.clue, focus, name);
      const text = f.cell
        ? `Allora la casella segnata può coprirla solo ${who}, e solo così.`
        : `Allora ${who} ha un posto solo: questo.`;
      frames.push({
        text: `${count}${text}`,
        ghost,
        chain: forced.slice(0, n + 1).map((g) => ({ rect: g.rect, clue: g.clue })),
        marks: f.cell ? [f.cell] : [],
        subject: f.clue,
        problems: [],
      });
    });
    const chain = forced.map((g) => ({ rect: g.rect, clue: g.clue }));
    const end =
      "clue" in problem
        ? `Ma così ${otherName(problem.clue, focus, name)} non ha più spazio.`
        : "Ma così la casella in rosso non può coprirla più nessuno.";
    frames.push({ text: `${count}${end}`, ghost, chain, marks: [], problems: ["clue" in problem ? problem.clue : problem.cell] });
  });
  const rest =
    total === 1
      ? `Quindi ${name(focus)} va nell'altro modo.`
      : `Nessuna di queste ${total} forme va: ${name(focus)} può stare in un modo solo.`;
  frames.push({ text: rest, chain: [], marks: [], subject: focus, problems: [] });
  return frames;
}

/** What a clue's shape requires, to explain a rectangle with the wrong shape. */
export const SHAPE_NEEDS: Record<Shape, string> = {
  square: "un quadrato",
  oblong: "un rettangolo non quadrato",
  wide: "un rettangolo più largo che alto",
  tall: "un rettangolo più alto che largo",
};

/** Why the (highlighted) rectangle is wrong, in words (misplaced: see hintText). */
export function wrongText(why: Exclude<WrongReason, { kind: "misplaced" }>, rect: Rect, name: Namer): string {
  switch (why.kind) {
    case "empty":
      return "non contiene nessun indizio";
    case "many":
      return `contiene ${why.count} indizi`;
    case "area":
      return `${name(why.clue)} vuole ${why.clue.n} caselle, qui ce ne sono ${area(rect)}`;
    case "shape":
      return `${name(why.clue)} vuole ${SHAPE_NEEDS[why.clue.shape!]}`;
    case "starved":
      return `così ${name(why.clue)} non avrebbe più spazio`;
    case "uncovered":
      return "così la casella evidenziata non la potrebbe coprire nessun indizio";
  }
}

/** "12 s": how long is left, rounded up. */
export function secondsLeft(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

/** A shown hint (the cooldown isn't shown as a hint, but as a notice). */
export type ShownHint = Exclude<Hint, { wait: number }>;

/** "Ne resta 1." / "Suggerimenti finiti." after a limited hint. */
export function leftText(left: number): string {
  return left === 0 ? "Suggerimenti finiti." : left === 1 ? "Ne resta 1." : `Ne restano ${left}.`;
}

export function hintText(hint: ShownHint, frame: number, name: Namer): string {
  if ("quiet" in hint) {
    const n = hint.removed.length;
    const what = hint.placed ? "Ecco un pezzo." : n === 1 ? "Tolto un rettangolo sbagliato." : `Tolti ${n} rettangoli sbagliati.`;
    return `${what} ${leftText(hint.left)}`;
  }
  if ("removed" in hint) {
    if (hint.wrong.why.kind === "misplaced") {
      // The reason can't be seen from the grid: no sentence, just the correct piece.
      const of = name(hint.wrong.why.clue, "di");
      const where = hint.placed ? "ecco dove va" : "dove va te lo mostro al prossimo suggerimento";
      return hint.removed.length === 1
        ? `Tolto un rettangolo sbagliato ${of}: ${where}.`
        : `Tolti ${hint.removed.length} rettangoli sbagliati. Quello evidenziato era ${of}: ${where}.`;
    }
    const why = wrongText(hint.wrong.why, hint.wrong.rect, name);
    return hint.removed.length === 1
      ? `Tolto un rettangolo sbagliato: ${why}.`
      : `Tolti ${hint.removed.length} rettangoli sbagliati. Quello evidenziato: ${why}.`;
  }
  if ("focus" in hint) return `Guarda ${name(hint.focus.clue)}: si può già capire dove va.`;
  if ("explain" in hint) {
    const frames = explainFrames(hint.explain, name);
    return frames[frame % frames.length]!.text;
  }
  if (hint.fix) return `Ecco dove va ${name(hint.fix)}.`;
  return reasonText(hint.reason, name);
}

/** The cells to highlight for a hint: clues and decisive cell (the explanation has its own). */
export function hintSpots(hint: ShownHint): { r: number; c: number }[] {
  if ("quiet" in hint) return [];
  if ("removed" in hint) {
    const { why } = hint.wrong;
    return why.kind === "starved" ? [why.clue] : why.kind === "uncovered" ? [why.cell] : [];
  }
  if ("focus" in hint) return [hint.focus.clue];
  if ("explain" in hint) return [];
  if (!hint.reason) return [];
  return hint.reason.only ? [hint.reason.only, hint.reason.clue] : [hint.reason.clue];
}

export const HINT_LABELS = ["Suggerimento", "Perché?", "Mostra il pezzo"];
