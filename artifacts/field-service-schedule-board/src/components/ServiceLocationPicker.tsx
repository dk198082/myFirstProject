import { useState, useRef, useEffect, useCallback } from "react";
import { useListWbServiceLocations, getListWbServiceLocationsQueryKey, type WbServiceLocation } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, X, MapPin, Search } from "lucide-react";

interface ServiceLocationValue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface ServiceLocationPickerProps {
  label?: string;
  value: ServiceLocationValue | null;
  onChange: (value: ServiceLocationValue | null) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function ServiceLocationPicker({ label = "Service location", value, onChange }: ServiceLocationPickerProps) {
  const [inputValue, setInputValue] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(inputValue, 300);

  const isSelectedByValue = value !== null && inputValue === value.name;

  const searchParams = { search: debouncedSearch, limit: 20 };
  const { data: results = [], isFetching, error, refetch } = useListWbServiceLocations(
    searchParams,
    {
      query: {
        queryKey: getListWbServiceLocationsQueryKey(searchParams),
        enabled: open && debouncedSearch.length >= 2 && !isSelectedByValue,
        staleTime: 60_000,
        retry: false,
      },
    },
  );

  const crmUnavailable = error !== null && error !== undefined;

  const handleSelect = useCallback(
    (loc: WbServiceLocation) => {
      onChange({ id: loc.id, name: loc.name, city: loc.city ?? null, state: loc.state ?? null });
      setInputValue(loc.name);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setInputValue("");
    setOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (!value) setInputValue("");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [value]);

  const showDropdown = open && debouncedSearch.length >= 2 && !isSelectedByValue;

  return (
    <div className="space-y-1.5 min-w-0" ref={containerRef}>
      <Label>{label}</Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (value && e.target.value !== value.name) {
              onChange(null);
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name, city, or state…"
          className="w-full min-w-0 pl-8 pr-8"
          autoComplete="off"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear service location"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : isFetching ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground pointer-events-none" />
        ) : null}
      </div>
      {value && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-0.5">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {[value.city, value.state].filter(Boolean).join(", ") || value.name}
          </span>
        </div>
      )}
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full max-w-[calc(100%-2rem)] rounded-md border border-border bg-popover shadow-md overflow-hidden">
          {crmUnavailable && !isFetching && (
            <div className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 flex items-center justify-between gap-2">
              <span>CRM unavailable — enter location manually</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="underline underline-offset-2 hover:no-underline shrink-0"
              >
                Retry
              </button>
            </div>
          )}
          {!crmUnavailable && results.length === 0 && !isFetching && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No locations found</div>
          )}
          {results.map((loc) => (
            <button
              key={loc.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent focus:bg-accent outline-none transition-colors"
              onPointerDown={(e) => {
                e.preventDefault();
                handleSelect(loc);
              }}
            >
              <div className="font-medium truncate">{loc.name}</div>
              {(loc.city || loc.state) && (
                <div className="text-xs text-muted-foreground truncate">
                  {[loc.address, loc.city, loc.state].filter(Boolean).join(", ")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
