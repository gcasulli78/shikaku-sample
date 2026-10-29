import type { DeductionKind } from "./grader";
import type { Clue, Difficulty, Variant } from "./types";

/** Un passo del tutorial: una griglia scritta a mano che si risolve con la regola spiegata. */
export interface TutorialStep {
  title: string;
  text: string;
  variant: Variant;
  rows: number;
  cols: number;
  clues: Clue[];
  /** Caselle nere (r * cols + c), solo nella variante Caselle nere. */
  blocked?: number[];
  /** Livello del valutatore e come si arriva al primo pezzo suggerito (verificati dai test). */
  level: Difficulty;
  firstRule: DeductionKind;
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: "Le regole",
    text:
      "Dividi la griglia in rettangoli: ognuno contiene un solo numero e ha tante caselle quanto quel numero. " +
      "Trascina per disegnare un rettangolo, tocca un rettangolo per toglierlo. Qui il 4 può stare in un solo modo: comincia da lì.",
    variant: "classic",
    rows: 2,
    cols: 3,
    clues: [
      { r: 0, c: 0, n: 2 },
      { r: 1, c: 2, n: 4 },
    ],
    level: "easy",
    firstRule: "single",
  },
  {
    title: "Una casella, un solo numero",
    text:
      "Se una casella la può raggiungere un solo numero, fa parte del suo rettangolo, e spesso gli resta una sola forma. " +
      "Se ti blocchi, il suggerimento ti indica prima l'indizio da guardare, poi il ragionamento.",
    variant: "classic",
    rows: 4,
    cols: 5,
    clues: [
      { r: 1, c: 0, n: 2 },
      { r: 0, c: 2, n: 4 },
      { r: 1, c: 2, n: 4 },
      { r: 1, c: 3, n: 4 },
      { r: 3, c: 0, n: 2 },
      { r: 3, c: 3, n: 4 },
    ],
    level: "medium",
    firstRule: "single",
  },
  {
    title: "Niente buchi",
    text:
      "Una forma va scartata se lascerebbe caselle che nessun numero può più coprire, o un numero senza spazio. " +
      "Qui all'inizio nessun numero ha una forma sola: cerca quella che lascerebbe un buco.",
    variant: "classic",
    rows: 5,
    cols: 5,
    clues: [
      { r: 1, c: 2, n: 8 },
      { r: 2, c: 0, n: 4 },
      { r: 2, c: 3, n: 6 },
      { r: 3, c: 4, n: 3 },
      { r: 4, c: 1, n: 4 },
    ],
    level: "hard",
    firstRule: "direct",
  },
  {
    title: "Ipotesi",
    text:
      "A volte serve provare: scegli un numero con poche forme possibili, immagina di posarne una e segui le conseguenze. " +
      "Se porta a una contraddizione, quella forma è sbagliata. È il ragionamento dei livelli Esperto e Maestro.",
    variant: "classic",
    rows: 6,
    cols: 6,
    clues: [
      { r: 2, c: 0, n: 12 },
      { r: 0, c: 3, n: 6 },
      { r: 3, c: 5, n: 6 },
      { r: 3, c: 3, n: 6 },
      { r: 5, c: 2, n: 4 },
      { r: 4, c: 4, n: 2 },
    ],
    level: "expert",
    firstRule: "chain",
  },
  {
    title: "Variante Forme",
    text:
      "Nella variante Forme il contorno dietro l'indizio dice la forma: quadrato, rettangolo orizzontale o verticale, " +
      "oppure la croce, cioè non quadrato con orientamento libero. Senza numero l'area è libera; il ? lascia libere forma e area.",
    variant: "shapes",
    rows: 5,
    cols: 5,
    clues: [
      { r: 0, c: 0, n: 6, shape: "tall" },
      { r: 1, c: 3 },
      { r: 2, c: 4, n: 5, shape: "oblong" },
      { r: 2, c: 3, n: 2 },
      { r: 3, c: 0, n: 4 },
      { r: 3, c: 3, n: 4, shape: "square" },
    ],
    level: "medium",
    firstRule: "single",
  },
  {
    title: "Variante Caselle nere",
    text:
      "Nella variante Caselle nere i numeri funzionano come nel Classico, ma le caselle scure non si coprono: " +
      "i rettangoli ci girano attorno, e spesso sono proprio loro a dire dove non può andare un numero.",
    variant: "blocked",
    rows: 5,
    cols: 5,
    clues: [
      { r: 1, c: 0, n: 5 },
      { r: 2, c: 2, n: 6 },
      { r: 3, c: 4, n: 5 },
      { r: 3, c: 3, n: 3 },
      { r: 4, c: 1, n: 4 },
    ],
    blocked: [3, 8],
    level: "medium",
    firstRule: "single",
  },
];
