/** Tailwind recipes for the product's bounded, semantic motion families. */
export const motionStyles = {
  navigate: "data-[motion-event=navigate]:[transform-origin:right_center] data-[motion-event=navigate]:[animation:motion-page-enter_var(--motion-duration-navigate)_var(--motion-ease-enter)_both]",
  reveal: "data-[motion-event=reveal]:[transform-origin:top_center] data-[motion-event=reveal]:[animation:motion-reveal-enter_var(--motion-duration-reveal)_var(--motion-ease-enter)_both]",
  sheetVeil: "data-[motion-event=reveal]:[transform-origin:top_center] data-[motion-event=reveal]:[animation:motion-veil-enter_var(--motion-duration-feedback)_linear_both]",
  sheetReveal: "data-[motion-event=reveal]:[transform-origin:bottom_center] data-[motion-event=reveal]:[animation:motion-sheet-enter_var(--motion-duration-reveal)_var(--motion-ease-enter)_both]",
  moveShelf: "data-[motion-event=move-shelf]:[transform-origin:left_center] data-[motion-event=move-shelf]:[animation:motion-row-settle_var(--motion-duration-move)_var(--motion-ease-move)_both]",
  complete: "data-[motion-event=complete]:[&_.finish-mark]:[transform-origin:left_center] data-[motion-event=complete]:[&_.finish-mark]:[animation:motion-complete-mark_var(--motion-duration-complete)_var(--motion-ease-enter)_both] data-[motion-event=complete]:[&_.finish-celebration_h3]:[animation:motion-ink-reveal_var(--motion-duration-complete)_linear_both]",
  undo: "data-[motion-event=undo]:[animation:motion-undo-confirm_var(--motion-duration-feedback)_var(--motion-ease-exit)_both]",
  progressFill: "[transform-origin:left_center] [transition:width_var(--motion-duration-progress)_linear]",
} as const
