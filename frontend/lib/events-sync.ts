// Klient-side klient for /api/vault/events.
// Alle events lagres server-side; klienten bare rapporterer og henter.

export type ClientEventKind =
  | "unlock-success"
  | "unlock-fail"
  | "unlock-biometric"
  | "master-changed";

export interface VaultEvent {
  id: string;
  at: string;
  kind: string;
  ip: string;
  device: string;
  userAgent: string;
  location?: string;
  country?: string;
  city?: string;
}

const ENDPOINT = "/api/vault/events";

export async function reportEvent(kind: ClientEventKind): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
      keepalive: true,
    });
  } catch {
    // Ikke la logging-feil bryte bruker-flow
  }
}

export async function fetchEvents(limit: number = 100): Promise<VaultEvent[]> {
  const res = await fetch(`${ENDPOINT}?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Server returnerte ${res.status}`);
  }
  const data = await res.json();
  return (data.events as VaultEvent[]) || [];
}

export async function clearEvents(): Promise<void> {
  const res = await fetch(ENDPOINT, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Sletting feilet (${res.status})`);
  }
}
