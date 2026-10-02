"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Browser history snapshots (back/forward cache) can repaint a protected page
 * without a network request. When that happens, revalidate through the real
 * server boundary so a restored snapshot never stands in for current access.
 * This is event-driven, not polling.
 */
export const RestoredPageRevalidator = () => {
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        router.refresh();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
};
