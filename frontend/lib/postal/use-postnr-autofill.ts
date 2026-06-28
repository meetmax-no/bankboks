/**
 * Ko | Do · Vault — usePostnrAutofill
 *
 * D-105: én delt hook for postnr→poststed-autofill. Brukes på alle 4
 * felt-par i TenantViewer (company + billing × create + edit).
 *
 * Atferd:
 *   - Debouncer 400ms etter siste postnr-endring
 *   - Validerer format først (NO/DK = 4 sifre)
 *   - Kaller lookupPoststed → autofyller poststed via setCity
 *   - Overskriver eksisterende poststed (lookup vinner) ved treff
 *   - Ved null/feil: rører ikke poststed-feltet
 *   - Andre country-verdier (SE/OTHER/""): inaktiv
 */
"use client";

import { useEffect, useRef } from "react";
import { isValidPostnr, lookupPoststed } from "./lookup";

export function usePostnrAutofill(args: {
  country: string;
  postnr: string;
  setCity: (v: string) => void;
}) {
  const { country, postnr } = args;

  // setCity er ofte en inline-arrow fra parent — bruk ref for å unngå
  // å trigge useEffect på hver parent-rerender.
  const setCityRef = useRef(args.setCity);
  setCityRef.current = args.setCity;

  // Husk siste vellykkede oppslag så vi ikke fyrer det samme to ganger.
  const lastSuccessKeyRef = useRef<string>("");

  useEffect(() => {
    const trimmed = postnr.trim();
    if (!isValidPostnr(country, trimmed)) return;

    const key = `${country}:${trimmed}`;
    if (lastSuccessKeyRef.current === key) return;

    const handle = setTimeout(async () => {
      const city = await lookupPoststed(country, trimmed);
      if (city) {
        lastSuccessKeyRef.current = key;
        setCityRef.current(city);
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [country, postnr]);
}
