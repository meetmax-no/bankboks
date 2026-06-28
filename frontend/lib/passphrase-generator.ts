// Diceware-style passfrase-generator med norsk ordliste.

import { pickWord } from "./wordlist-nb";

export type PassphraseSeparator = "+" | "-" | "_" | ".";

export interface PassphraseOptions {
  wordCount: number;
  separator: PassphraseSeparator;
  capitalize: boolean;
}

export const DEFAULT_PASSPHRASE_OPTS: PassphraseOptions = {
  wordCount: 4,
  separator: "+",
  capitalize: true,
};

function capFirst(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function generatePassphrase(
  opts: Partial<PassphraseOptions> = {},
): string {
  const o: PassphraseOptions = { ...DEFAULT_PASSPHRASE_OPTS, ...opts };
  const count = Math.max(2, Math.min(10, o.wordCount));
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = pickWord();
    if (o.capitalize) w = capFirst(w);
    words.push(w);
  }
  return words.join(o.separator);
}
