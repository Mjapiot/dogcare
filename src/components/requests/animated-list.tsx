"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * A list whose items enter and leave smoothly (e.g. a card answered in
 * "À répondre" slides away and the others close the gap).
 */
export function AnimatedList({ items, className }: { items: Array<{ key: string; node: ReactNode }>; className?: string }) {
  return (
    <ul className={className}>
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((i) => (
          <motion.li
            key={i.key}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -32, transition: { duration: 0.25, ease: EASE } }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {i.node}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
