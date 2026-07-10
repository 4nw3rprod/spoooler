'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';

interface DecryptedTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: 'start' | 'end' | 'center';
  useOriginalCharsOnly?: boolean;
  characters?: string;
  className?: string;
  encryptedClassName?: string;
  parentClassName?: string;
  animateOn?: 'view' | 'hover' | 'click';
}

export default function DecryptedText({
  text,
  speed = 40,
  maxIterations = 10,
  sequential = true,
  revealDirection = 'start',
  useOriginalCharsOnly = false,
  characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+',
  className = '',
  parentClassName = '',
  encryptedClassName = '',
  animateOn = 'view',
  ...props
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState<string>(text);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());

  const availableChars = useMemo<string[]>(() => {
    return useOriginalCharsOnly
      ? Array.from(new Set(text.split(''))).filter(char => char !== ' ')
      : characters.split('');
  }, [useOriginalCharsOnly, text, characters]);

  const shuffleText = useCallback(
    (originalText: string, currentRevealed: Set<number>) => {
      return originalText
        .split('')
        .map((char, i) => {
          if (char === ' ') return ' ';
          if (currentRevealed.has(i)) return originalText[i];
          return availableChars[Math.floor(Math.random() * availableChars.length)];
        })
        .join('');
    },
    [availableChars]
  );

  const computeOrder = useCallback(
    (len: number): number[] => {
      const order: number[] = [];
      if (len <= 0) return order;
      if (revealDirection === 'start') {
        for (let i = 0; i < len; i++) order.push(i);
        return order;
      }
      if (revealDirection === 'end') {
        for (let i = len - 1; i >= 0; i--) order.push(i);
        return order;
      }
      // center
      const middle = Math.floor(len / 2);
      let offset = 0;
      while (order.length < len) {
        if (offset % 2 === 0) {
          const idx = middle + offset / 2;
          if (idx >= 0 && idx < len) order.push(idx);
        } else {
          const idx = middle - Math.ceil(offset / 2);
          if (idx >= 0 && idx < len) order.push(idx);
        }
        offset++;
      }
      return order;
    },
    [revealDirection]
  );

  const triggerAnimation = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setRevealedIndices(new Set());
    
    let currentRevealed = new Set<number>();
    const order = computeOrder(text.length);
    let step = 0;
    
    const interval = setInterval(() => {
      if (sequential) {
        if (step < order.length) {
          currentRevealed.add(order[step]);
          setRevealedIndices(new Set(currentRevealed));
          setDisplayText(shuffleText(text, currentRevealed));
          step++;
        } else {
          setDisplayText(text);
          setIsAnimating(false);
          clearInterval(interval);
        }
      } else {
        if (step < maxIterations) {
          setDisplayText(shuffleText(text, currentRevealed));
          step++;
        } else {
          setDisplayText(text);
          setIsAnimating(false);
          clearInterval(interval);
        }
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, maxIterations, sequential, computeOrder, shuffleText, isAnimating]);

  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (animateOn === 'view' && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      triggerAnimation();
    }
    // Run once on mount; triggerAnimation is intentionally excluded to avoid re-firing in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateOn]);

  const handleMouseEnter = () => {
    if (animateOn === 'hover') {
      triggerAnimation();
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (animateOn === 'click') {
      triggerAnimation();
    }
    if (props.onClick) {
      props.onClick(e);
    }
  };

  return (
    <span 
      className={`inline-block whitespace-pre-wrap cursor-default ${parentClassName}`}
      onMouseEnter={handleMouseEnter}
      onClick={handleClick}
      {...props}
    >
      {displayText.split('').map((char, index) => {
        const isRevealed = revealedIndices.has(index) || !isAnimating;
        return (
          <span
            key={index}
            className={isRevealed ? className : encryptedClassName}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
