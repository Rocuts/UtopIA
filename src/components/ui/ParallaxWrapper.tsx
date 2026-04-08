'use client';

import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { useRef, ReactNode } from 'react';

interface ParallaxWrapperProps {
  children: ReactNode;
  speed?: number; // -1 to 1, negative = slower, positive = faster
  className?: string;
  offset?: ['start end' | 'start start' | 'end start' | 'end end' | 'center center', 'start end' | 'start start' | 'end start' | 'end end' | 'center center'];
}

export function ParallaxWrapper({
  children,
  speed = 0.2,
  className,
  offset = ['start end', 'end start'],
}: ParallaxWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    offset: offset as any,
  });

  const rawY = useTransform(scrollYProgress, [0, 1], [speed * -100, speed * 100]);
  const y = useSpring(rawY, { stiffness: 100, damping: 30, mass: 0.5 });

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y, willChange: 'transform' }}>
        {children}
      </motion.div>
    </div>
  );
}

// Staggered reveal animation for children entering viewport
interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  distance?: number;
}

export function Reveal({
  children,
  className,
  delay = 0,
  direction = 'up',
  distance = 40,
}: RevealProps) {
  const directionMap = {
    up: { x: 0, y: distance },
    down: { x: 0, y: -distance },
    left: { x: distance, y: 0 },
    right: { x: -distance, y: 0 },
  };

  const initial = { opacity: 0, ...directionMap[direction] };

  return (
    <motion.div
      className={className}
      initial={initial}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{
        duration: 0.7,
        ease: [0.25, 0.1, 0.25, 1],
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// Counter animation for metrics
interface CountUpProps {
  target: string;
  className?: string;
}

export function CountUp({ target, className }: CountUpProps) {
  // Extract numeric value and prefix/suffix
  const match = target.match(/^([^\d]*)([\d.]+)(.*)$/);
  if (!match) return <span className={className}>{target}</span>;

  const [, prefix, numStr, suffix] = match;
  const num = parseFloat(numStr);

  return (
    <motion.span
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.5 }}
    >
      {prefix}
      <CountUpNumber target={num} decimals={numStr.includes('.') ? numStr.split('.')[1].length : 0} />
      {suffix}
    </motion.span>
  );
}

function CountUpNumber({ target, decimals }: { target: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const nodeRef = useRef<HTMLSpanElement>(null);

  return (
    <motion.span
      ref={nodeRef}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.5 }}
    >
      <motion.span
        ref={ref}
        variants={{
          hidden: {},
          visible: {},
        }}
      >
        <CountUpInner target={target} decimals={decimals} />
      </motion.span>
    </motion.span>
  );
}

function CountUpInner({ target, decimals }: { target: number; decimals: number }) {
  const value = useSpring(0, { stiffness: 50, damping: 20 });
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  return (
    <motion.span
      ref={ref}
      onViewportEnter={() => {
        if (!hasAnimated.current) {
          hasAnimated.current = true;
          value.set(target);
        }
      }}
      viewport={{ once: true, amount: 0.5 }}
    >
      <MotionNumber value={value} decimals={decimals} />
    </motion.span>
  );
}

function MotionNumber({ value, decimals }: { value: ReturnType<typeof useSpring>; decimals: number }) {
  const display = useTransform(value, (v: number) => v.toFixed(decimals));
  return <motion.span>{display}</motion.span>;
}
