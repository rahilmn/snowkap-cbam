"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "cmdk";

import {
  Loader2,
  Search,
} from "lucide-react";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  cn,
} from "../../../../lib/utils";

import {
  searchCbamGoodsAction,
} from "./actions";

interface CbamGoodOption {
  trade_code: string;
  trade_code_type: string;
  description: string;
}

const SEARCH_DEBOUNCE_MS =
  250;

/**
 * "CN" / "TARIC" are the raw regulatory trade_code_type values
 * (supabase/migrations/20260826133116_create_regulatory_foundation.sql's
 * own CHECK constraint) -- this maps them to the human-readable
 * CN8/TARIC10 labels the rest of the app already uses (mirroring
 * mapCodeLevel in src/infrastructure/regulatory/
 * supabase-regulatory-repository.ts, not imported directly since app/
 * may not reach into src/infrastructure/ -- this is a two-case display
 * mapping, not business logic worth a shared helper for).
 */
function codeTypeLabel(
  tradeCodeType: string,
): string {
  switch (tradeCodeType) {
    case "CN":
      return "CN8";

    case "TARIC":
      return "TARIC10";

    default:
      return tradeCodeType;
  }
}

/**
 * Searchable CN/TARIC classification combobox, backed live by the
 * canonical cbam_goods dataset (searchCbamGoodsAction ->
 * searchCbamGoodsByText, never an invented or static candidate list --
 * all 283 goods are never fetched at once). Renders as a real text
 * input under the hood (cmdk's CommandInput forwards unknown props,
 * including `name`, straight to the underlying <input> DOM node), so
 * this is a drop-in replacement for the plain <Input name="cnCode">
 * it replaces in add-line-form.tsx: whatever text currently sits in
 * the field -- typed freely, pasted as an exact code, or filled in by
 * clicking a search result -- is exactly what the surrounding <form>
 * submits, so the existing server-side classification pipeline
 * (classifyLine/addLine) is completely untouched by this change; this
 * component only makes finding and previewing the right code easier,
 * it never itself decides whether a code is valid -- that stays the
 * server's job, preserving the classification/determination boundary
 * this codebase already keeps strict.
 *
 * No `id` prop, deliberately: cmdk's CommandInput spreads caller props
 * onto the underlying <input> but then unconditionally overwrites `id`
 * with its own internally-generated one (wiring aria-controls/
 * aria-labelledby/aria-activedescendant to the listbox) -- confirmed by
 * reading cmdk's own compiled source, not assumed from its "all props
 * are forwarded" doc comment, which does not hold for this one prop. A
 * caller-supplied id is silently discarded, which would otherwise
 * orphan a sibling <label htmlFor="..."> pointing at an id that never
 * lands in the DOM (found live: the browser-rendered input's real id
 * was cmdk's own "radix-_r_5_", not the "cnCode" this component used to
 * accept). The caller (add-line-form.tsx) associates its visible label
 * by wrapping this component instead (implicit <label> association,
 * which needs no id at all) rather than fighting cmdk for the id.
 */
export function CnCodePicker(
  {
    name,
    defaultValue = "",
    disabled,
    required,
    onSelectDescription,
  }: {
    name: string;
    defaultValue?: string;
    disabled?: boolean;
    required?: boolean;
    onSelectDescription?: (description: string) => void;
  },
) {
  const [query, setQuery] =
    useState(
      defaultValue,
    );

  const [open, setOpen] =
    useState(
      false,
    );

  const [results, setResults] =
    useState<CbamGoodOption[]>(
      [],
    );

  const [loading, setLoading] =
    useState(
      false,
    );

  const [hasSearched, setHasSearched] =
    useState(
      false,
    );

  const containerRef =
    useRef<HTMLDivElement>(
      null,
    );

  const requestIdRef =
    useRef(
      0,
    );

  useEffect(
    () => {
      const trimmed =
        query.trim();

      if (trimmed.length < 2) {
        setResults(
          [],
        );

        setLoading(
          false,
        );

        setHasSearched(
          false,
        );

        return;
      }

      const requestId =
        ++requestIdRef.current;

      setLoading(
        true,
      );

      const timer =
        setTimeout(
          () => {
            searchCbamGoodsAction(
              trimmed,
            ).then(
              (found) => {
                // Stale-response guard: a slower earlier request
                // resolving after a newer one would otherwise
                // overwrite fresher results with outdated ones.
                if (requestId !== requestIdRef.current) {
                  return;
                }

                setResults(
                  found,
                );

                setLoading(
                  false,
                );

                setHasSearched(
                  true,
                );
              },
            ).catch(
              () => {
                if (requestId !== requestIdRef.current) {
                  return;
                }

                setResults(
                  [],
                );

                setLoading(
                  false,
                );

                setHasSearched(
                  true,
                );
              },
            );
          },
          SEARCH_DEBOUNCE_MS,
        );

      return () => {
        clearTimeout(
          timer,
        );
      };
    },
    [query],
  );

  useEffect(
    () => {
      function handlePointerDown(
        event: MouseEvent,
      ) {
        if (
          containerRef.current &&
          !containerRef.current.contains(
            event.target as Node,
          )
        ) {
          setOpen(
            false,
          );
        }
      }

      document.addEventListener(
        "mousedown",
        handlePointerDown,
      );

      return () => {
        document.removeEventListener(
          "mousedown",
          handlePointerDown,
        );
      };
    },
    [],
  );

  function selectGood(
    good: CbamGoodOption,
  ) {
    setQuery(
      good.trade_code,
    );

    setOpen(
      false,
    );

    onSelectDescription?.(
      good.description,
    );
  }

  const showPanel =
    open && query.trim().length >= 2;

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <Command
        shouldFilter={false}
        className="w-full"
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          />

          <CommandInput
            name={name}
            required={required}
            disabled={disabled}
            value={query}
            onValueChange={setQuery}
            onFocus={() => setOpen(true)}
            autoComplete="off"
            placeholder="Search by code or description, e.g. 25232100 or cement"
            aria-expanded={showPanel}
            aria-autocomplete="list"
            className={cn(
              "h-10 w-full rounded-[var(--radius-md)] border bg-[var(--surface-page)] " +
                "pl-9 pr-3 text-sm text-[var(--text-primary)] " +
                "placeholder:text-[var(--text-tertiary)] " +
                "transition-colors duration-150 " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-2 focus-visible:outline-offset-2",
              "border-[var(--border-default)] hover:border-[var(--border-strong)]",
            )}
          />
        </div>

        {showPanel ? (
          <CommandList
            className={cn(
              "absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto",
              "rounded-[var(--radius-md)] border border-[var(--border-default)]",
              "bg-[var(--surface-overlay)] shadow-[var(--shadow-overlay)]",
              "p-1",
            )}
          >
            {loading ? (
              <CommandLoading className="flex items-center gap-2 px-3 py-2.5 text-sm text-[var(--text-tertiary)]">
                <Loader2
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                />

                Searching CBAM goods…
              </CommandLoading>
            ) : null}

            {!loading && hasSearched && results.length === 0 ? (
              <CommandEmpty className="px-3 py-2.5 text-sm text-[var(--text-tertiary)]">
                {`No CBAM goods found for "${query.trim()}".`}
              </CommandEmpty>
            ) : null}

            {!loading &&
              results.map(
                (good) => (
                  <CommandItem
                    key={good.trade_code}
                    value={good.trade_code}
                    onSelect={() => selectGood(good)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-sm)] px-3 py-2",
                      "data-[selected=true]:bg-[var(--surface-sunken)]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-[var(--text-primary)]">
                        {good.trade_code}
                      </span>

                      <Badge tone="brand">
                        {codeTypeLabel(good.trade_code_type)}
                      </Badge>
                    </span>

                    <span className="text-xs text-[var(--text-secondary)]">
                      {good.description}
                    </span>
                  </CommandItem>
                ),
              )}
          </CommandList>
        ) : null}
      </Command>
    </div>
  );
}
