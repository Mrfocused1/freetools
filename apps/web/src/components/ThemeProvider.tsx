"use client";

import { useEffect } from "react";

// Runs exactly once on mount to sync the current theme from localStorage
// (or system preference) to the <html> element. SSR renders with no theme
// attribute (dark by default). The matching inline script in the layout
// avoids a flash of wrong theme by running before hydration.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // no-op — the inline script already set data-theme before paint.
    // We listen here for changes made by the ThemeToggle.
  }, []);
  return <>{children}</>;
}

// Inline script injected into <head> that runs synchronously on first paint,
// preventing a dark→light or light→dark flash.
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('quickfix-theme');
    var theme = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;
