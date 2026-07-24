import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const storagePrefix = "closetsearch.scroll.";

export function ScrollPositionRestoration() {
  const location = useLocation();
  const locationKey = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let frameId: number | undefined;

    try {
      const storedPosition = window.sessionStorage.getItem(`${storagePrefix}${locationKey}`);
      const parsedPosition = Number(storedPosition);

      if (storedPosition && Number.isFinite(parsedPosition)) {
        frameId = window.requestAnimationFrame(() => {
          window.scrollTo({
            behavior: "instant",
            top: parsedPosition,
          });
        });
      }
    } catch {
      // Session storage can be unavailable in privacy-restricted contexts.
    }

    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }

      try {
        window.sessionStorage.setItem(`${storagePrefix}${locationKey}`, String(window.scrollY));
      } catch {
        // Navigation must still work when session storage is unavailable.
      }
    };
  }, [locationKey]);

  return null;
}
