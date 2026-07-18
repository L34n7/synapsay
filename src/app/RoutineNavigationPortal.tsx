"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function RoutineNavigationPortal() {
  const [navigation, setNavigation] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const findNavigation = () => {
      const element = document.querySelector<HTMLElement>(
        '[aria-label="Navegação principal"]',
      );
      if (element) setNavigation(element);
      return Boolean(element);
    };

    if (findNavigation()) return;

    const observer = new MutationObserver(() => {
      if (findNavigation()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!navigation) return null;

  return createPortal(
    <a href="/rotinas" aria-label="Rotinas" title="Rotinas">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M4 12h10M4 18h7M17 11l3 3-3 3" />
      </svg>
    </a>,
    navigation,
  );
}
