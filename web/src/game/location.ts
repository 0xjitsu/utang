// Which barangay street is the player looking at? null = their own street.
import { useEffect, useState } from "react";

let visiting: string | null = null;
const listeners = new Set<(v: string | null) => void>();

export function getVisiting() {
  return visiting;
}

export function setVisiting(v: string | null) {
  if (v === visiting) return;
  visiting = v;
  listeners.forEach((f) => f(v));
}

export function useVisiting(): [string | null, (v: string | null) => void] {
  const [v, setV] = useState(visiting);
  useEffect(() => {
    listeners.add(setV);
    setV(visiting);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return [v, setVisiting];
}
