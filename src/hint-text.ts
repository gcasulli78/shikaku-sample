/**
 * Le parole del suggerimento, senza DOM: come si chiamano gli indizi ("il 6 verde"), le
 * frasi di ogni grado e i passi della spiegazione con cosa evidenziare. ui.ts le disegna.
 */
import type { Hint, Reason, WrongReason } from "./game";
import { area, type Clue, type Rect, type Shape } from "./types";

/**
 * Nome a parole della tinta di una pastiglia (vedi HUES): nei suggerimenti "il 6 verde"
 * distingue due 6 meglio di "l'altro 6" (segnalato dall'utente: non si capiva quale).
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

/** Come si chiama un indizio nelle frasi: con articolo e, se la pastiglia è colorata, il colore. */
export type Namer = (clue: Clue, prep?: Prep) => string;

/**
 * L'indizio con l'articolo, semplice o con di/a: "il 6 verde", "dell'8", "all'indizio blu".
 * Si apostrofano i numeri che si leggono con una vocale (uno, otto, undici, ottanta…).
 * Niente nome della forma ("il 2 non quadrato" suonava strano): il colore basta.
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

/** Riepilogo del motivo quando il pezzo è posato. */
export function reasonText(reason: Reason | undefined, name: Namer): string {
  if (!reason) return "Nessuna deduzione semplice da qui: ecco un pezzo della soluzione.";
  if (reason.kind === "single") return `${capitalize(name(reason.clue))} può stare solo così.`;
  if (reason.only) return `Solo ${name(reason.clue)} arriva alla casella segnata: ecco come.`;
  return `Le altre forme ${name(reason.clue, "di")} creavano un problema: resta questa.`;
}

/**
 * Un passo della spiegazione: la frase e cosa si vede. ghost: la forma che si prova
 * (tratteggiata nella tinta del suo indizio); chain: i pezzi che diventerebbero obbligati,
 * ognuno nella tinta del suo indizio; marks: le caselle segnate di cui parla la frase;
 * subject: l'indizio di cui parla, cerchiato; problems: il problema, l'unica cosa in rosso.
 */
export interface Frame {
  text: string;
  ghost?: { rect: Rect; clue: Clue };
  chain: { rect: Rect; clue: Clue }[];
  marks: { r: number; c: number }[];
  subject?: Clue;
  problems: { r: number; c: number }[];
}

/** Un altro indizio nella spiegazione: "l'altro 4 verde" se si chiama come quello che si guarda. */
export function otherName(clue: Clue, focus: Clue, name: Namer): string {
  const own = name(clue);
  return clue !== focus && own === name(focus) ? `l'altro ${own.replace(/^(il |l')/, "")}` : own;
}

/**
 * La spiegazione a passi, una cosa per volta (segnalato dall'utente: tutto in una frase con
 * tutto disegnato insieme non si seguiva). Per ogni forma scartata: si prova la forma ("Proviamo
 * il 2 verde qui, nel tratteggio"), poi un passo per ogni pezzo che diventa obbligato, poi il
 * problema. Le figure si accumulano: nel passo del problema si vede tutta la catena. Alla
 * fine la conclusione. Si guarda un indizio solo e tutto si verifica sulla griglia.
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

/** Cosa chiede la forma di un indizio, per spiegare un rettangolo della forma sbagliata. */
export const SHAPE_NEEDS: Record<Shape, string> = {
  square: "un quadrato",
  oblong: "un rettangolo non quadrato",
  wide: "un rettangolo più largo che alto",
  tall: "un rettangolo più alto che largo",
};

/** Perché il rettangolo (evidenziato) è sbagliato, a parole (misplaced: vedi hintText). */
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

/** "12 s": quanto manca, arrotondato per eccesso. */
export function secondsLeft(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

/** Un suggerimento mostrato (l'attesa non si mostra come suggerimento, ma come avviso). */
export type ShownHint = Exclude<Hint, { wait: number }>;

/** "Ne resta 1." / "Suggerimenti finiti." dopo un suggerimento limitato. */
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
      // Il motivo non si vede dalla griglia: niente frase, il pezzo giusto.
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

/** Le caselle da evidenziare per un suggerimento: indizi e casella decisiva (la spiegazione ha le sue). */
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
