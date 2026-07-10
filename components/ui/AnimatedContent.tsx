'use client';

// ReactBits — AnimatedContent. Reveals children (fade + slide) when scrolled
// into view. GSAP-free port using IntersectionObserver + CSS transition, tuned
// to the page's motion system (0.34s ease).
// https://reactbits.dev/animations/animated-content
import React, { useEffect, useRef, useState } from 'react';

interface AnimatedContentProps {
  children: React.ReactNode;
  distance?: number;
  direction?: 'vertical' | 'horizontal';
  duration?: number;
  delay?: number;
  threshold?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function AnimatedContent({
  children,
  distance = 40,
  direction = 'vertical',
  duration = 0.34,
  delay = 0,
  threshold = 0.15,
  className = '',
  style,
}: AnimatedContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  const axis = direction === 'horizontal' ? 'X' : 'Y';

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translate3d(0,0,0)' : `translate${axis}(${distance}px)`,
        transition: `opacity ${duration}s ease ${delay}s, transform ${duration}s ease ${delay}s`,
        willChange: 'opacity, transform',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
