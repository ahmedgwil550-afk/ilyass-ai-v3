"use client";

import * as React from "react";
import { MetalFx } from "metal-fx";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

export interface MetalPromptBarProps {
  children: React.ReactElement;
  className?: string;
  preset?: "chromatic" | "silver" | "gold";
  strength?: number;
}

/**
 * Liquid-metal send-button frame for the existing ILYASS AI composer.
 * Keeps the current textarea, attachments, PDF flow and send handlers intact.
 * Effect by Jakub Antalík's metal-fx (MIT): https://github.com/Jakubantalik/metal-fx
 */
export function MetalPromptBar({
  children,
  className,
  preset = "chromatic",
  strength = 0.9,
}: MetalPromptBarProps) {
  const { isDark } = useTheme();

  return (
    <MetalFx
      variant="circle"
      preset={preset}
      theme={isDark ? "dark" : "light"}
      strength={strength}
      className={cn("inline-flex shrink-0", className)}
    >
      {children}
    </MetalFx>
  );
}

export default MetalPromptBar;
