"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  Moon,
  Sun,
} from "lucide-react";

import {
  Button,
} from "../ui/button";

const STORAGE_KEY =
  "snowkap-theme";

type Theme =
  | "light"
  | "dark";

function applyTheme(
  theme: Theme,
): void {
  document.documentElement.setAttribute(
    "data-theme",
    theme,
  );

  try {
    localStorage.setItem(
      STORAGE_KEY,
      theme,
    );
  } catch {
    // Storage can be unavailable (private browsing, blocked site
    // data); the theme still applies for this page load, it just
    // won't persist. Never let a storage failure break the toggle.
  }
}

/**
 * An explicit toggle always wins over the OS preference -- see the
 * :root[data-theme="dark"] / :root[data-theme="light"] rules in
 * app/globals.css. The inline script in app/layout.tsx applies any
 * previously-stored choice before first paint (avoiding a flash of the
 * wrong theme); this component only needs to read that same storage
 * key to know which icon to show on mount.
 */
export function ThemeToggle() {
  const [
    theme,
    setTheme,
  ] =
    useState<Theme | null>(
      null,
    );

  useEffect(() => {
    const stored =
      document.documentElement.getAttribute(
        "data-theme",
      );

    setTheme(
      stored === "dark" || stored === "light"
        ? stored
        : "light",
    );
  }, []);

  function toggle() {
    const next: Theme =
      theme === "dark"
        ? "light"
        : "dark";

    setTheme(
      next,
    );

    applyTheme(
      next,
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={
        theme === "dark"
          ? "Switch to light theme"
          : "Switch to dark theme"
      }
    >
      {theme === "dark" ? (
        <Sun
          className="size-4"
          aria-hidden="true"
        />
      ) : (
        <Moon
          className="size-4"
          aria-hidden="true"
        />
      )}
    </Button>
  );
}
