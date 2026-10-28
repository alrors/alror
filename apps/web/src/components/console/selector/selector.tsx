"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/site";

/**
 * Accessible single and multi selectors for the console.
 *
 *   <Selector name="service" options={[{ value: "api", label: "api" }]} defaultValue="api" />
 *   <MultiSelector name="scopes" options={...} value={scopes} onValueChange={setScopes} />
 *
 * - A button trigger (role=combobox) opens a listbox in a portal, so it is never
 *   clipped by tables, cards or dialogs. It flips above the trigger near the bottom.
 * - Search box (automatic above 7 options), groups, icons, descriptions, a right
 *   side meta (badge or count), a clear row, and an empty state.
 * - Keyboard: arrows, Home/End, Enter, Space, Esc, Tab, and type-ahead.
 * - Renders hidden <input name=…> so plain forms and server actions get the value;
 *   `submitOnChange` submits the surrounding form (filter bars, role pickers).
 */

export type SelectorOption = {
  value: string;
  label: string;
  /** Second line in the list. */
  description?: string;
  /** Muted text after the label in the trigger. */
  hint?: string;
  icon?: React.ReactNode;
  /** Right side of the row: a count or a small badge. */
  meta?: React.ReactNode;
  group?: string;
  disabled?: boolean;
  /** Extra words the search matches. */
  keywords?: string;
};

type Shared = {
  options: SelectorOption[];
  /** Form field name; a hidden input carries the value. */
  name?: string;
  id?: string;
  /** Accessible name when there is no visible <label htmlFor>. */
  "aria-label"?: string;
  placeholder?: string;
  /** true, false, or "auto" (more than 7 options). */
  searchable?: boolean | "auto";
  searchPlaceholder?: string;
  /** Adds a clear row at the top of the list. */
  clearable?: boolean;
  clearLabel?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  size?: "sm" | "md";
  /** field: bordered like an input. ghost: borderless (top bar switchers). */
  variant?: "field" | "ghost";
  className?: string;
  popoverClassName?: string;
  /** Minimum popover width in px (defaults to the trigger's width, at least 200). */
  minWidth?: number;
  align?: "start" | "end";
  /** Submit the surrounding form after a change. */
  submitOnChange?: boolean;
  footer?: React.ReactNode;
  /** Shown before the value in the trigger, e.g. "Sort". */
  prefix?: React.ReactNode;
};

export type SelectorProps = Shared & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Custom trigger content for the selected option. */
  renderValue?: (option: SelectorOption | undefined) => React.ReactNode;
};

export type MultiSelectorProps = Shared & {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Chips shown in the trigger before "+N". */
  maxChips?: number;
};

const CLEAR = "\u0000clear";

function matches(o: SelectorOption, q: string): boolean {
  if (!q) return true;
  return [o.label, o.value, o.description ?? "", o.group ?? "", o.keywords ?? ""].some((s) => s.toLowerCase().includes(q));
}

function triggerClass(variant: "field" | "ghost", size: "sm" | "md", disabled?: boolean) {
  return cn(
    "group/sel con-ease inline-flex min-w-0 items-center gap-2 text-left outline-none",
    size === "sm" ? "h-7 text-[12px]" : "h-8 text-[13px]",
    variant === "field"
      ? "w-full rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg hover:border-con-line-hover focus-visible:border-con-line-hover aria-expanded:border-con-line-hover"
      : "rounded-md px-1.5 text-con-fg hover:bg-con-hover focus-visible:bg-con-hover aria-expanded:bg-con-hover",
    disabled && "pointer-events-none text-con-fg3 opacity-70",
  );
}

/* --------------------------------- Core --------------------------------- */

function useSelectorCore({
  options,
  selected,
  multiple,
  onPick,
  onClear,
  searchable: searchableProp = "auto",
  clearable,
  disabled,
  hasValue,
}: {
  options: SelectorOption[];
  selected: string[];
  /** Something is chosen (the clear row only shows then). */
  hasValue: boolean;
  multiple: boolean;
  onPick: (o: SelectorOption) => void;
  onClear: () => void;
  searchable?: boolean | "auto";
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const typeahead = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });
  /** Set when the list closes from the keyboard or a pick, so focus goes back to the trigger. */
  const focusBack = useRef(false);
  /** Enter/Space handled on keydown; swallow the click the browser fires for them on the trigger. */
  const keyClick = useRef(false);
  const searchable = searchableProp === "auto" ? options.length > 7 : searchableProp;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((o) => matches(o, q)), [options, q]);
  const showClear = Boolean(clearable) && hasValue && !q;
  /** Navigable rows: the clear row (if any) then the filtered options. */
  const rows = useMemo(() => [...(showClear ? [{ value: CLEAR, label: "" } as SelectorOption] : []), ...filtered], [showClear, filtered]);

  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < rows.length; i += step) if (!rows[i].disabled) return i;
    return -1;
  };

  const openList = (initialQuery = "") => {
    if (disabled) return;
    setQuery(initialQuery);
    const list = initialQuery ? options.filter((o) => matches(o, initialQuery.toLowerCase())) : options;
    const offset = !initialQuery && clearable && hasValue ? 1 : 0;
    const sel = list.findIndex((o) => selected.includes(o.value) && !o.disabled);
    setActive(sel >= 0 ? sel + offset : offset);
    setOpen(true);
  };
  const close = useCallback((returnFocus = false) => {
    focusBack.current = returnFocus;
    setOpen(false);
    setQuery("");
  }, []);

  const choose = (i: number) => {
    const row = rows[i];
    if (!row || row.disabled) return;
    if (row.value === CLEAR) {
      onClear();
      if (!multiple) close(true);
      else setActive(0);
      return;
    }
    onPick(row);
    if (!multiple) close(true);
  };

  /** Type-ahead without a search box: jump to the next label starting with what was typed. */
  const typeAhead = (ch: string) => {
    const now = Date.now();
    const t = typeahead.current;
    t.buf = now - t.at < 600 ? t.buf + ch.toLowerCase() : ch.toLowerCase();
    t.at = now;
    const start = t.buf.length === 1 ? active + 1 : active;
    for (let k = 0; k < rows.length; k++) {
      const i = (start + k) % rows.length;
      const r = rows[i];
      if (r.value !== CLEAR && !r.disabled && r.label.toLowerCase().startsWith(t.buf)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        keyClick.current = e.key === "Enter" || e.key === " ";
        openList();
      } else if (printable && searchable) {
        e.preventDefault();
        openList(e.key);
      } else if (printable && !multiple) {
        // Like a native select: typing picks the matching option without opening.
        const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
        if (i >= 0) onPick(options[i]);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const n = firstEnabled(active + 1, 1);
        setActive(n >= 0 ? n : firstEnabled(0, 1));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const n = firstEnabled(active - 1, -1);
        setActive(n >= 0 ? n : firstEnabled(rows.length - 1, -1));
        break;
      }
      case "Home":
        e.preventDefault();
        setActive(Math.max(0, firstEnabled(0, 1)));
        break;
      case "End":
        e.preventDefault();
        setActive(Math.max(0, firstEnabled(rows.length - 1, -1)));
        break;
      case "PageDown":
        e.preventDefault();
        setActive(Math.max(0, firstEnabled(Math.min(rows.length - 1, active + 8), -1)));
        break;
      case "PageUp":
        e.preventDefault();
        setActive(Math.max(0, firstEnabled(Math.max(0, active - 8), 1)));
        break;
      case "Enter":
        e.preventDefault();
        // Focus is on the trigger only without a search box.
        if (!searchable) keyClick.current = true;
        choose(active);
        break;
      case "Escape":
        // Close only this list, not the dialog around it.
        // React listens on the document, like the dialog does: stop the other listeners too.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        close(true);
        break;
      case "Tab":
        // From the search box (rendered at the end of the page) go back to the trigger.
        if (searchable) {
          e.preventDefault();
          close(true);
        } else close();
        break;
      case " ":
        if (!searchable) {
          e.preventDefault();
          keyClick.current = true;
          choose(active);
        }
        break;
      default:
        if (printable && !searchable) {
          const i = typeAhead(e.key);
          if (i >= 0) setActive(i);
        }
    }
  };

  /** Trigger click: toggles the list, unless it is the click a handled Enter/Space key produces. */
  const onTriggerClick = () => {
    if (keyClick.current) {
      keyClick.current = false;
      return;
    }
    if (open) close();
    else openList();
  };
  const onKeyUp = () => {
    setTimeout(() => {
      keyClick.current = false;
    }, 0);
  };

  return { open, setOpen, openList, close, focusBack, onTriggerClick, onKeyUp, query, setQuery, active, setActive, rows, filtered, showClear, searchable, choose, onKeyDown };
}

type Core = ReturnType<typeof useSelectorCore>;

/** Fixed-position popover placed under (or above) the trigger; follows scroll and resize. */
function Popover({
  anchor,
  core,
  ids,
  multiple,
  selected,
  label,
  searchPlaceholder,
  clearLabel,
  emptyText,
  footer,
  minWidth,
  align,
  className,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  core: Core;
  ids: { list: string; opt: (i: number) => string };
  multiple: boolean;
  selected: string[];
  label?: string;
  searchPlaceholder?: string;
  clearLabel: string;
  emptyText: string;
  footer?: React.ReactNode;
  minWidth?: number;
  align: "start" | "end";
  className?: string;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { rows, active, setActive, choose, close, query, setQuery, searchable, onKeyDown } = core;

  useLayoutEffect(() => {
    const el = pop.current;
    const a = anchor.current;
    if (!el || !a) return;
    const place = (e?: Event) => {
      if (e && e.target instanceof Node && el.contains(e.target)) return;
      const r = a.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, minWidth ?? 200), vw - 16);
      let left = align === "end" ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, vw - width - 8));
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      const chrome = (searchable ? 45 : 0) + (footer ? 44 : 0) + 10;
      const listMax = Math.max(120, Math.min(320, (up ? above : below) - chrome));
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.style.top = up ? "" : `${r.bottom + 6}px`;
      el.style.bottom = up ? `${vh - r.top + 6}px` : "";
      el.style.transformOrigin = up ? "bottom" : "top";
      el.style.setProperty("--sel-max", `${listMax}px`);
      el.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, minWidth, align, searchable, footer]);

  useEffect(() => {
    if (searchable) search.current?.focus();
  }, [searchable]);

  useEffect(() => {
    document.getElementById(ids.opt(active))?.scrollIntoView({ block: "nearest" });
  }, [active, ids]);

  // Group consecutive options under their group label (order as given).
  const sections: { group?: string; items: { o: SelectorOption; i: number }[] }[] = [];
  rows.forEach((o, i) => {
    if (o.value === CLEAR) return;
    const last = sections[sections.length - 1];
    if (last && last.group === o.group) last.items.push({ o, i });
    else sections.push({ group: o.group, items: [{ o, i }] });
  });
  const hasClear = rows[0]?.value === CLEAR;

  const optionRow = (o: SelectorOption, i: number) => {
    const isSel = selected.includes(o.value);
    return (
      <li
        key={o.value}
        id={ids.opt(i)}
        role="option"
        aria-selected={isSel}
        aria-disabled={o.disabled || undefined}
        data-active={i === active}
        onMouseMove={() => i !== active && !o.disabled && setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(i)}
        className={cn(
          "flex min-h-8 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-con-fg2 transition-colors duration-100",
          "data-[active=true]:bg-con-row data-[active=true]:text-con-fg",
          o.disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {multiple && (
          <span
            aria-hidden
            className={cn(
              "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors duration-100",
              isSel ? "border-con-fg bg-con-fg text-black" : "border-con-line-hover",
            )}
          >
            {isSel && <Check size={10} strokeWidth={3} />}
          </span>
        )}
        {o.icon && <span className="grid h-5 w-5 shrink-0 place-items-center text-con-fg2">{o.icon}</span>}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", isSel && "text-con-fg")}>{o.label}</span>
          {o.description && <span className="block truncate text-[12px] text-con-fg3">{o.description}</span>}
        </span>
        {o.meta != null && <span className="shrink-0 text-[12px] tabular-nums text-con-fg3">{o.meta}</span>}
        {!multiple && <Check size={14} aria-hidden className={cn("shrink-0 text-con-fg", isSel ? "opacity-100" : "opacity-0")} />}
      </li>
    );
  };

  return (
    <div
      ref={pop}
      className={cn(
        "con-scale-in fixed z-[70] flex flex-col overflow-hidden rounded-lg border border-con-line bg-con-panel shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)]",
        className,
      )}
      style={{ visibility: "hidden" }}
      onMouseDown={(e) => {
        // Keep focus on the trigger or the search box while clicking inside.
        if (e.target !== search.current) e.preventDefault();
      }}
    >
      {searchable && (
        <div className="border-b border-con-line p-1.5">
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-con-fg3">
            <Search size={14} className="shrink-0" aria-hidden />
            <input
              ref={search}
              role="combobox"
              aria-expanded
              aria-controls={ids.list}
              aria-autocomplete="list"
              aria-activedescendant={rows.length ? ids.opt(active) : undefined}
              aria-label={label ? `Search ${label.toLowerCase()}` : "Search"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder ?? "Search…"}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3"
            />
          </div>
        </div>
      )}
      <ul
        id={ids.list}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="con-scroll overflow-y-auto p-1"
        style={{ maxHeight: "var(--sel-max, 320px)" }}
      >
        {hasClear && (
          <li
            id={ids.opt(0)}
            role="option"
            aria-selected={false}
            data-active={active === 0}
            onMouseMove={() => active !== 0 && setActive(0)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(0)}
            className="flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 text-[13px] text-con-fg3 data-[active=true]:bg-con-row data-[active=true]:text-con-fg"
          >
            <X size={14} aria-hidden className="shrink-0" />
            <span className="flex-1 truncate">{clearLabel}</span>
          </li>
        )}
        {sections.map((s, si) =>
          s.group ? (
            <li key={`${s.group}:${si}`} role="presentation" className={cn(si > 0 || hasClear ? "mt-1 border-t border-con-line pt-1" : "")}>
              <div id={`${ids.list}-g${si}`} className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-con-fg3">
                {s.group}
              </div>
              <ul role="group" aria-labelledby={`${ids.list}-g${si}`}>
                {s.items.map(({ o, i }) => optionRow(o, i))}
              </ul>
            </li>
          ) : (
            s.items.map(({ o, i }) => optionRow(o, i))
          ),
        )}
      </ul>
      {core.filtered.length === 0 && (
        <div className="px-3 pb-4 pt-3 text-center text-[13px] text-con-fg3" role="status">
          {query ? `No matches for "${query.trim()}".` : emptyText}
        </div>
      )}
      {footer && (
        <div className="border-t border-con-line px-3 py-2 text-[12px] text-con-fg3" onClick={() => close()}>
          {footer}
        </div>
      )}
    </div>
  );
}

/** Closes the popover on a click outside the trigger and the popover. */
function useOutside(open: boolean, close: () => void, wrap: React.RefObject<HTMLElement | null>, listId: string) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrap.current?.contains(t)) return;
      if (document.getElementById(listId)?.parentElement?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close, wrap, listId]);
}

/** Moves focus back to the trigger after a keyboard close or a pick. */
function useFocusBack(open: boolean, flagRef: React.RefObject<boolean>, triggerRef: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (open || !flagRef.current) return;
    flagRef.current = false;
    triggerRef.current?.focus();
  }, [open, flagRef, triggerRef]);
}

function useControllable<T>(value: T | undefined, defaultValue: T) {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  return [controlled ? (value as T) : inner, setInner, controlled] as const;
}

/* -------------------------------- Selector -------------------------------- */

export function Selector(props: SelectorProps) {
  const {
    options,
    name,
    id,
    placeholder = "Select…",
    clearLabel = "Clear selection",
    emptyText = "Nothing to choose from.",
    disabled,
    required,
    size = "md",
    variant = "field",
    className,
    popoverClassName,
    minWidth,
    align = "start",
    submitOnChange,
    footer,
    prefix,
    onValueChange,
    renderValue,
    searchPlaceholder,
  } = props;
  const [value, setInner, controlled] = useControllable(props.value, props.defaultValue ?? "");
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const ids = useMemo(() => ({ list: `${uid}-list`, opt: (i: number) => `${uid}-opt-${i}` }), [uid]);
  const current = options.find((o) => o.value === value);
  const label = props["aria-label"];

  const commit = useCallback(
    (next: string) => {
      if (next === value) return;
      flushSync(() => {
        if (!controlled) setInner(next);
        onValueChange?.(next);
      });
      if (submitOnChange) wrap.current?.closest("form")?.requestSubmit();
    },
    [value, controlled, setInner, onValueChange, submitOnChange],
  );

  const selectedList = useMemo(() => (options.some((o) => o.value === value) ? [value] : []), [options, value]);
  const core = useSelectorCore({
    options,
    selected: selectedList,
    hasValue: value !== "",
    multiple: false,
    onPick: (o) => commit(o.value),
    onClear: () => commit(""),
    searchable: props.searchable,
    clearable: props.clearable,
    disabled,
  });
  const { open, close } = core;
  const closeOutside = useCallback(() => close(), [close]);
  useOutside(open, closeOutside, wrap, ids.list);
  useFocusBack(open, core.focusBack, trigger);

  return (
    <span ref={wrap} className={cn("relative inline-flex min-w-0", variant === "field" && "w-full", className)}>
      {name && <input type="hidden" name={name} value={value} required={required} />}
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? ids.list : undefined}
        aria-activedescendant={open && !core.searchable && core.rows.length ? ids.opt(core.active) : undefined}
        aria-label={label}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={core.onTriggerClick}
        onKeyUp={core.onKeyUp}
        onKeyDown={core.onKeyDown}
        className={triggerClass(variant, size, disabled)}
      >
        {prefix && <span className="shrink-0 text-con-fg3">{prefix}</span>}
        {renderValue ? (
          renderValue(current)
        ) : current ? (
          <>
            {current.icon && <span className="grid h-4 w-4 shrink-0 place-items-center text-con-fg2">{current.icon}</span>}
            <span className="min-w-0 truncate">{current.label}</span>
            {current.hint && <span className="hidden shrink-0 truncate text-con-fg3 sm:inline">{current.hint}</span>}
          </>
        ) : (
          <span className="min-w-0 truncate text-con-fg3">{placeholder}</span>
        )}
        <ChevronsUpDown size={14} aria-hidden className="ml-auto shrink-0 text-con-fg3" />
      </button>
      {open &&
        createPortal(
          <Popover
            anchor={trigger}
            core={core}
            ids={ids}
            multiple={false}
            selected={selectedList}
            label={label ?? placeholder}
            searchPlaceholder={searchPlaceholder}
            clearLabel={clearLabel}
            emptyText={emptyText}
            footer={footer}
            minWidth={minWidth}
            align={align}
            className={popoverClassName}
          />,
          document.body,
        )}
    </span>
  );
}

/* ------------------------------ MultiSelector ------------------------------ */

export function MultiSelector(props: MultiSelectorProps) {
  const {
    options,
    name,
    id,
    placeholder = "Select…",
    clearLabel = "Clear all",
    emptyText = "Nothing to choose from.",
    disabled,
    required,
    size = "md",
    variant = "field",
    className,
    popoverClassName,
    minWidth,
    align = "start",
    submitOnChange,
    footer,
    prefix,
    onValueChange,
    searchPlaceholder,
    maxChips = 3,
  } = props;
  const [value, setInner, controlled] = useControllable<string[]>(props.value, props.defaultValue ?? []);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const ids = useMemo(() => ({ list: `${uid}-list`, opt: (i: number) => `${uid}-opt-${i}` }), [uid]);
  const label = props["aria-label"];

  const commit = useCallback(
    (next: string[]) => {
      // Keep the options' order, so hidden inputs and chips are stable.
      const ordered = options.map((o) => o.value).filter((v) => next.includes(v));
      flushSync(() => {
        if (!controlled) setInner(ordered);
        onValueChange?.(ordered);
      });
      if (submitOnChange) wrap.current?.closest("form")?.requestSubmit();
    },
    [options, controlled, setInner, onValueChange, submitOnChange],
  );

  const core = useSelectorCore({
    options,
    selected: value,
    hasValue: value.length > 0,
    multiple: true,
    onPick: (o) => commit(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]),
    onClear: () => commit([]),
    searchable: props.searchable,
    clearable: props.clearable,
    disabled,
  });
  const { open, close } = core;
  const closeOutside = useCallback(() => close(), [close]);
  useOutside(open, closeOutside, wrap, ids.list);
  useFocusBack(open, core.focusBack, trigger);

  const chosen = options.filter((o) => value.includes(o.value));
  const shown = chosen.slice(0, maxChips);

  return (
    <span ref={wrap} className={cn("relative inline-flex min-w-0", variant === "field" && "w-full", className)}>
      {name && value.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      {name && required && value.length === 0 && <input type="text" tabIndex={-1} aria-hidden required value="" onChange={() => {}} className="sr-only" />}
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? ids.list : undefined}
        aria-activedescendant={open && !core.searchable && core.rows.length ? ids.opt(core.active) : undefined}
        aria-label={label ? `${label}${chosen.length ? `: ${chosen.map((c) => c.label).join(", ")}` : ""}` : undefined}
        disabled={disabled}
        onClick={core.onTriggerClick}
        onKeyUp={core.onKeyUp}
        onKeyDown={(e) => {
          if (!open && e.key === "Backspace" && value.length) {
            e.preventDefault();
            commit(value.slice(0, -1));
            return;
          }
          core.onKeyDown(e);
        }}
        className={cn(triggerClass(variant, size, disabled), "h-auto min-h-8 py-1")}
      >
        {prefix && <span className="shrink-0 text-con-fg3">{prefix}</span>}
        {chosen.length === 0 ? (
          <span className="min-w-0 truncate text-con-fg3">{placeholder}</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {shown.map((o) => (
              <span key={o.value} className="con-scale-in inline-flex h-[22px] max-w-full items-center gap-1 rounded bg-con-row px-1.5 text-[12px] text-con-fg">
                {o.icon && <span className="grid h-3.5 w-3.5 place-items-center text-con-fg2">{o.icon}</span>}
                <span className="truncate">{o.label}</span>
              </span>
            ))}
            {chosen.length > shown.length && <span className="text-[12px] text-con-fg3">+{chosen.length - shown.length}</span>}
          </span>
        )}
        <ChevronsUpDown size={14} aria-hidden className="ml-auto shrink-0 text-con-fg3" />
      </button>
      {open &&
        createPortal(
          <Popover
            anchor={trigger}
            core={core}
            ids={ids}
            multiple
            selected={value}
            label={label ?? placeholder}
            searchPlaceholder={searchPlaceholder}
            clearLabel={clearLabel}
            emptyText={emptyText}
            footer={footer}
            minWidth={minWidth}
            align={align}
            className={popoverClassName}
          />,
          document.body,
        )}
    </span>
  );
}
