"use client";

import React from "react";
import {ChevronDown} from "lucide-react";
import {cx} from "@/utils/cx";

/**
 * Collapsible — a self-contained expand/collapse section used to keep the reel
 * builder's option groups compact so the whole UI fits on a desktop screen
 * without page scroll. Header is always visible; body collapses with a smooth
 * grid-rows transition. State can be controlled or uncontrolled.
 */
export function Collapsible({
  title,
  subtitle,
  icon,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const isOpen = controlledOpen ?? uncontrolled;
  const toggle = () => {
    const next = !isOpen;
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) setUncontrolled(next);
  };

  return (
    <div className={cx("rounded-lg border border-border bg-muted/20 overflow-hidden", className)}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={isOpen}
      >
        {icon ? <span className="flex-shrink-0 text-muted-foreground">{icon}</span> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{title}</span>
            {badge}
          </span>
          {subtitle ? <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span> : null}
        </span>
        {right}
        <ChevronDown
          size={16}
          className={cx("flex-shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>
      {/* grid-rows trick gives a smooth height animation without measuring */}
      <div
        className={cx(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-3 py-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
