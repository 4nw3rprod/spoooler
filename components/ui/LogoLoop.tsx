'use client';

// Seamless horizontal logo marquee with edge fade and pause-on-hover.
// Uses hardware-accelerated CSS animations for butter-smooth scrolling.
import React, { useEffect, useRef, useState } from 'react';
import BrandLogo from './BrandLogo';

export interface LogoItem {
  src: string;
  title: string;
  fallback?: string; // shown if `src` fails to load
}

interface LogoLoopProps {
  logos: LogoItem[];
  speed?: number; // px per second
  direction?: 'left' | 'right';
  logoHeight?: number;
  gap?: number;
  pauseOnHover?: boolean;
  fadeOut?: boolean;
  fadeOutColor?: string;
  label?: boolean;
  isStatic?: boolean;
  className?: string;
}

export default function LogoLoop({
  logos,
  speed = 60,
  direction = 'left',
  logoHeight = 28,
  gap = 56,
  pauseOnHover = true,
  fadeOut = true,
  fadeOutColor = '#f5f5f7',
  label = true,
  isStatic = false,
  className = '',
}: LogoLoopProps) {
  const seqRef = useRef<HTMLUListElement>(null);
  const [seqWidth, setSeqWidth] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Measure the sequence width so we know how long one full cycle takes at the given speed (px/sec).
  useEffect(() => {
    if (isStatic) return;
    const measure = () => {
      const seq = seqRef.current;
      if (!seq) return;
      setSeqWidth(seq.getBoundingClientRect().width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (seqRef.current) ro.observe(seqRef.current);
    return () => ro.disconnect();
  }, [logos, gap, logoHeight, isStatic]);

  if (isStatic) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap,
          width: '100%',
          maxWidth: 1024,
          margin: '0 auto',
          padding: '0 22px',
        }}
      >
        {logos.map((logo, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <BrandLogo
              src={logo.src}
              fallback={logo.fallback}
              alt={logo.title}
              style={{ height: logoHeight, width: 'auto', opacity: 0.85 }}
            />
            {label && (
              <span
                style={{
                  fontFamily: "'SF Pro Text', Inter, system-ui, sans-serif",
                  fontSize: 15,
                  fontWeight: 500,
                  color: '#1d1d1f',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                }}
              >
                {logo.title}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Compute duration in seconds: distance (seqWidth) / speed (px/sec)
  const duration = seqWidth > 0 ? seqWidth / speed : 30;


  const listItems = (ref: React.RefObject<HTMLUListElement | null> | undefined) => (
    <ul
      ref={ref}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap,
        margin: 0,
        padding: 0,
        paddingRight: gap,
        listStyle: 'none',
        flexShrink: 0,
      }}
    >
      {logos.map((logo, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <BrandLogo
            src={logo.src}
            fallback={logo.fallback}
            alt={logo.title}
            style={{ height: logoHeight, width: 'auto', opacity: 0.85 }}
          />
          {label && (
            <span
              style={{
                fontFamily: "'SF Pro Text', Inter, system-ui, sans-serif",
                fontSize: 15,
                fontWeight: 500,
                color: '#1d1d1f',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              {logo.title}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'hidden', width: '100%' }}
      onMouseEnter={() => pauseOnHover && setIsPaused(true)}
      onMouseLeave={() => pauseOnHover && setIsPaused(false)}
    >

      <div
        style={{
          display: 'flex',
          width: 'max-content',
          willChange: 'transform',
          animationName: direction === 'left' ? 'logoMarquee-left' : 'logoMarquee-right',
          animationDuration: `${duration}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationPlayState: isPaused ? 'paused' : 'running',
        }}
      >
        {listItems(seqRef)}
        {listItems(undefined)}
      </div>

      {fadeOut && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: 120,
              background: `linear-gradient(90deg, ${fadeOutColor}, transparent)`,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '0 0 0 auto',
              width: 120,
              background: `linear-gradient(270deg, ${fadeOutColor}, transparent)`,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        </>
      )}
    </div>
  );
}

