"use client";

import { useEffect } from "react";

/**
 * Browser history snapshots can restore protected pages without a request.
 * Hide before a snapshot is saved and revalidate via a fresh document before
 * restored content can be shown again.
 */
export const RestoredPageRevalidator = () => {
  useEffect(() => {
    const hidePrivateOutput = () => {
      document.documentElement.style.visibility = "hidden";
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hidePrivateOutput();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hidePrivateOutput();
        window.location.reload();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
};
