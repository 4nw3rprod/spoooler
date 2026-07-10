'use client';

// ReactBits — ShinyText. A light band sweeps across the text.
// https://reactbits.dev/text-animations/shiny-text
import React from 'react';

interface ShinyTextProps {
  text: string;
  speed?: number; // seconds per sweep
  baseColor?: string;
  shineColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function ShinyText({
  text,
  speed = 4,
  baseColor = 'rgba(255,255,255,0.65)',
  shineColor = 'rgba(255,255,255,1)',
  className = '',
  style,
}: ShinyTextProps) {
  return (
    <span
      className={className}
      style={{
        color: baseColor,
        backgroundImage: `linear-gradient(120deg, ${baseColor} 40%, ${shineColor} 50%, ${baseColor} 60%)`,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        animation: `shiny-text ${speed}s linear infinite`,
        ...style,
      }}
    >
      {text}
      <style>{`@keyframes shiny-text { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </span>
  );
}
