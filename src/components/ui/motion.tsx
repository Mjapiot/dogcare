"use client";

import { useEffect, useState } from "react";
import { MotionConfig, motion, type Variants } from "motion/react";

/** Honors the system "Reduce motion" setting for every animation below it. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const EASE = [0.32, 0.72, 0, 1] as const;

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};

// starts readable: the first screen is rendered on the server, before any script runs
const item: Variants = {
  hidden: { opacity: 0.35, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

// the entrance plays once per app session: switching tabs must not look like a reload
let entrancePlayed = false;

/** Children marked with <Rise> fade and rise one after the other, on the first screen of the session. */
export function Stagger({ className, children }: { className?: string; children: React.ReactNode }) {
  const [animate] = useState(() => !entrancePlayed);
  useEffect(() => {
    entrancePlayed = true;
  }, []);
  return (
    <motion.div className={className} variants={list} initial={animate ? "hidden" : false} animate="show">
      {children}
    </motion.div>
  );
}

export function Rise({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
