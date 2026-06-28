// Clipboard-utility: kopierer tekst og sletter automatisk etter N sekunder.
//
// Utfordringer vi håndterer:
// 1. setTimeout suspenderes av iOS Safari / mobil-Chrome når fanen er i
//    bakgrunnen — vi kan ikke stole på at timeren fyrer på riktig tid.
//    Løsning: Vi lagrer ABSOLUTT måltid og sjekker både via timer OG ved
//    visibilitychange/focus events.
// 2. navigator.clipboard.writeText() krever document focus — hvis brukeren
//    har byttet til en annen app, kan writeText feile med NotAllowedError.
//    Løsning: Hvis skriving feiler, venter vi på focus-event og prøver igjen.
// 3. navigator.clipboard.readText() krever bruker-gesture — vi kan ikke
//    bekrefte at det fortsatt er "vårt" passord på clipboard. Vi tømmer
//    uansett — North Star (D-001) prioriterer sikkerhet over bekvemmelighet.

type ClearCallback = (success: boolean) => void;

interface PendingClear {
  deadline: number; // epoch ms når clipboard skal tømmes
  timer: ReturnType<typeof setTimeout> | null;
  visibilityHandler: (() => void) | null;
  focusHandler: (() => void) | null;
  callback?: ClearCallback;
  fired: boolean; // hindrer dobbel-firing
}

let pending: PendingClear | null = null;

function teardown(): void {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.visibilityHandler) {
    document.removeEventListener("visibilitychange", pending.visibilityHandler);
  }
  if (pending.focusHandler) {
    window.removeEventListener("focus", pending.focusHandler);
  }
  pending = null;
}

async function tryClear(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText("");
    return true;
  } catch {
    return false;
  }
}

async function attemptClear(): Promise<void> {
  if (!pending || pending.fired) return;
  const ref = pending;

  // Ikke tøm hvis fanen er skjult — writeText vil trolig feile og uansett
  // har vi ikke brukerens oppmerksomhet. Vent på visibilitychange.
  if (document.hidden) return;

  const ok = await tryClear();

  if (ok) {
    ref.fired = true;
    const cb = ref.callback;
    teardown();
    cb?.(true);
    return;
  }

  // Skriving feilet — sannsynligvis mangler document focus. Vent på focus-
  // event og prøv igjen. (Vi teardowner ikke her — visibility/focus handlers
  // er fortsatt aktive og vil retry.)
}

export async function copyWithAutoClear(
  text: string,
  seconds: number,
  onCleared?: ClearCallback,
): Promise<void> {
  teardown();
  await navigator.clipboard.writeText(text);

  const deadline = Date.now() + seconds * 1000;

  pending = {
    deadline,
    timer: null,
    visibilityHandler: null,
    focusHandler: null,
    callback: onCleared,
    fired: false,
  };

  const tick = () => {
    if (!pending || pending.fired) return;
    const remaining = pending.deadline - Date.now();
    if (remaining <= 0) {
      void attemptClear();
    } else {
      // Re-schedule for gjenstående tid. På mobil der timer suspenderes
      // vil denne fire når fanen kommer tilbake (via visibility handler
      // under), så vi trenger ikke ekstra handling her.
      pending.timer = setTimeout(tick, remaining);
    }
  };

  const onVisibilityChange = () => {
    if (!pending || pending.fired) return;
    if (!document.hidden) {
      // Fanen er synlig igjen. Sjekk om deadline har passert.
      if (Date.now() >= pending.deadline) {
        void attemptClear();
      }
    }
  };

  const onFocus = () => {
    if (!pending || pending.fired) return;
    // Focus kom tilbake — hvis deadline passert, prøv å tøm nå
    // (writeText krever focus, så dette er riktig øyeblikk).
    if (Date.now() >= pending.deadline) {
      void attemptClear();
    }
  };

  pending.visibilityHandler = onVisibilityChange;
  pending.focusHandler = onFocus;

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);

  pending.timer = setTimeout(tick, seconds * 1000);
}

export function cancelPendingClipboardClear(): void {
  teardown();
}

/**
 * Manuell sletting av clipboard. Kalles fra "Slett clipboard"-knappen
 * i header / mobile bottom bar. Returnerer true hvis sletting lyktes.
 *
 * NB: Dette tømmer kun system-clipboard på enheten brukeren bruker.
 * Universal Clipboard, Paste/Maccy-historikk, Cloud Clipboard og iOS
 * Spotlight er utenfor vår kontroll. (D-017)
 */
export async function clearClipboardNow(): Promise<boolean> {
  teardown();
  try {
    await navigator.clipboard.writeText("");
    return true;
  } catch {
    return false;
  }
}
