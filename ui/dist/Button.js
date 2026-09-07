import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';
/*
  `accent`, `success` and `alarm` were added from evidence rather than taste.

  A drift-checker pass over the three apps found 26 hand-rolled buttons wearing
  fleet colours, and 11 of them had no correct target here. That is not the apps
  being lazy: four independent surfaces reached for a solid green, four for a
  tinted accent, and one for a bright red, because this file offered none of
  them. A component that does not cover what the fleet actually builds gets
  worked around, and every workaround is a button that stops following the
  theme.

  What each replaces, and why it is not one of the existing four:

  * `accent` — a notable action that is not THE action on the surface:
    HarborSentinel's "Open NMEA Data Monitor", OceanSentinel's log-book
    presets. All four sites had independently written the same thing
    (`bg-primary/15 border-primary/40 text-primary`). The only close variant
    was `active`, which sets `aria-pressed` and would announce an action as a
    toggle stuck on — a semantic regression, not a visual one, which is why
    these could not simply be converted.

  * `success` — a completion: VesselKeeper's "mark done" on maintenance tasks
    and punch-list items, OceanSentinel's preset apply. All four had written
    `bg-green text-bg-app font-bold`, and all four wrote `hover:bg-green`,
    which is a hover state that does nothing; the shared one brightens like
    `primary` does.

  * `alarm` — acknowledging or silencing an alarm, which is not `danger`.
    `danger` is for a destructive action the owner may not have meant, and is
    drawn dim and outlined to be resistible. Acknowledging an anchor-drag alarm
    is the opposite: it wants to be the brightest thing on a dark screen at
    04:00, found by a hand that is already reaching. HarborSentinel's
    ACKNOWLEDGE ALARMS had it right at `bg-red text-bg-app` — note the fleet's
    `--color-red` is the pale #ffb4ab, so this reads as high-contrast rather
    than as the deep `red-dim` that `danger` fills with.
*/
const VARIANT = {
    primary: 'bg-cyan text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-cyan-glow)]',
    secondary: 'bg-bg-card text-text-primary border border-border-color hover:bg-bg-card-hover hover:border-cyan/50',
    accent: 'bg-cyan/15 text-cyan border border-cyan/40 hover:bg-cyan/25 active:brightness-95',
    success: 'bg-green text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-green-glow)]',
    alarm: 'bg-red text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-red-glow)]',
    danger: 'bg-red-dim text-red border border-red/40 hover:bg-red/15',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
};
/**
 * All three apps ship an Android build, where 44px is the working minimum for
 * anything a wet thumb has to hit. `md` is that 44px; `sm` is 40px and is for
 * dense chrome (toolbars, table rows), not for a primary action.
 */
const SIZE = {
    // Below the touch floor on purpose. `dense` is for chrome a mouse drives —
    // a table row's inline actions, a compact list header — where a 40px control
    // would push the row apart. Never make it the only way to do something on a
    // phone: give the same action an `sm` or `md` control there.
    dense: 'h-8 px-2 text-[12px] gap-1 rounded-md',
    sm: 'h-10 px-3 text-[13px] gap-1.5 rounded-md',
    md: 'h-11 px-4 text-sm gap-2 rounded-lg',
};
/**
 * The lit state, matching @sentinel/theme's `.glass-btn-active`, which the
 * header and dock already use — so a toggled Button and a toggled dock item
 * read as the same thing.
 */
const ACTIVE = 'bg-cyan-dim border border-cyan text-cyan shadow-[0_0_12px_var(--color-cyan-glow)] hover:bg-cyan-dim';
/**
 * The fleet button. Labels are sentence case ("Save changes", not "SAVE & APPLY"),
 * with one exception: `alarm` labels are the shout they already are on the
 * screens that raise them.
 *
 * `primary` is the one main action on a surface; `accent` a notable secondary
 * one; `success` a completion; `alarm` acknowledging an alarm; `danger` a
 * destructive action; everything else `secondary` or `ghost`.
 */
export const Button = React.forwardRef(function Button({ variant = 'secondary', size = 'md', icon, loading = false, block = false, active, className, children, disabled, type = 'button', ...rest }, ref) {
    return (_jsxs("button", { ref: ref, type: type, disabled: disabled || loading, "aria-pressed": active === undefined ? undefined : active, className: cn('inline-flex items-center justify-center font-medium select-none whitespace-nowrap transition-[background-color,border-color,filter,transform] duration-150', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app', 'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 active:scale-[0.98]', VARIANT[variant], SIZE[size], 
        // After the variant, so a lit control wins over its resting colours.
        active && ACTIVE, block && 'w-full', className), ...rest, children: [loading ? _jsx(Loader2, { className: "animate-spin", size: size === 'sm' ? 14 : 16, "aria-hidden": true }) : icon, children] }));
});
