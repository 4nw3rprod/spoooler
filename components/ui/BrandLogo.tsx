'use client';

// <img> that falls back to a local asset if the primary src fails (e.g. a
// Brandfetch rate limit or an unknown domain). Holds the failure in state so
// parent re-renders don't reset it back to the broken URL.
import React, { useState } from 'react';

export default function BrandLogo({
  src, fallback, alt, style, className,
}: {
  src: string; fallback?: string; alt: string; style?: React.CSSProperties; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={failed && fallback ? fallback : src}
      alt={alt}
      className={className}
      style={style}
      onError={() => { if (!failed && fallback) setFailed(true); }}
    />
  );
}
