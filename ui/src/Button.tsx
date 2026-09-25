import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'success' | 'alarm' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'dense' | 'sm' | 'md';
/**
 * `default` is the fleet button's own shape. `bare` hands layout to the
 * caller's `className` -- see LAYOUT below for exactly what that means.
 */
export type ButtonLayout = 'default' | 'bare';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon rendered before the label. Pass a lucide element, e.g. `<Save size={16} />`. */
  icon?: React.ReactNode;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  /**
   * Drawn lit, for a control that is *on* rather than one that was clicked —
   * a monitored VHF channel, an open panel, a layer showing on the chart.
   *
   * Sets `aria-pressed`, so screen readers announce it as a toggle rather than
   * as a button that happens to look different. Reads over any variant; it is
   * `secondary` and `ghost` that were being hand-rolled for want of it.
   */
  active?: boolean;
  /**
   * `bare` drops everything about the button's shape -- display, alignment,
   * justification, height, padding, gap, radius, font size, font weight and
   * wrapping -- so the caller's `className` decides them. The variant keeps
   * its colours, border, hover, focus ring and disabled state. `size` is
   * ignored. For a row with a label left and a count right:
   * `layout="bare" className="w-full flex justify-between items-center px-3 py-2"`.
   */
  layout?: ButtonLayout;
  /**
   * The 44px Android touch minimum, where the caller has taken over the shape.
   * Defaults to on. It applies to `layout="bare"` (as `min-h-11`) and to the
   * `link` variant (as an invisible 44px-tall hit area that does not move
   * anything). `layout="default"` ignores it: there `size` sets the height,
   * and `dense` is under the floor on purpose. Pass `false` only for a control
   * a mouse drives, or one that already has a 44px-tall parent that is itself
   * the target.
   */
  touchFloor?: boolean;
}

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
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-cyan text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-cyan-glow)]',
  secondary: 'bg-bg-card text-text-primary border border-border-color hover:bg-bg-card-hover hover:border-cyan/50',
  accent: 'bg-cyan/15 text-cyan border border-cyan/40 hover:bg-cyan/25 active:brightness-95',
  success: 'bg-green text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-green-glow)]',
  alarm: 'bg-red text-bg-app hover:brightness-110 active:brightness-95 shadow-[0_0_12px_var(--color-red-glow)]',
  danger: 'bg-red-dim text-red border border-red/40 hover:bg-red/15',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
  // Text that acts: OceanSentinel's "Recentre" and "Install app", HarborSentinel's
  // "Manage plan". No fill at rest or on hover -- `ghost` fills on hover, which
  // is what kept these hand-rolled -- and no padding or height (see LINK_SIZE).
  link: 'bg-transparent text-cyan cursor-pointer hover:underline underline-offset-2',
};

/**
 * All three apps ship an Android build, where 44px is the working minimum for
 * anything a wet thumb has to hit. `md` is that 44px; `sm` is 40px and is for
 * dense chrome (toolbars, table rows), not for a primary action.
 */
const SIZE: Record<ButtonSize, string> = {
  // Below the touch floor on purpose. `dense` is for chrome a mouse drives —
  // a table row's inline actions, a compact list header — where a 40px control
  // would push the row apart. Never make it the only way to do something on a
  // phone: give the same action an `sm` or `md` control there.
  dense: 'h-8 px-2 text-[12px] gap-1 rounded-md',
  sm: 'h-10 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-11 px-4 text-sm gap-2 rounded-lg',
};

/**
 * `link` takes only the type size and icon gap from `size`: padding and a
 * 44px height are what would relayout a status bar the link sits in. Its
 * touch target comes from LINK_TOUCH instead. No font weight either, so it
 * inherits the text around it and a caller's `font-bold` has nothing to fight.
 */
const LINK_SIZE: Record<ButtonSize, string> = {
  dense: 'text-[12px] gap-1',
  sm: 'text-[13px] gap-1.5',
  md: 'text-sm gap-2',
};

/**
 * A link's 44px touch target, drawn as an invisible `::before` centred on the
 * text, so the hit area grows and the layout does not. The `relative` it needs
 * is the one layout class a link emits: a caller who positions a link with
 * `absolute` or `fixed` should pass `touchFloor={false}` and give the parent
 * the height instead.
 */
const LINK_TOUCH = "relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

/**
 * What `layout` controls. `cn` concatenates rather than merging Tailwind, and
 * two classes setting the same property resolve by their order in the
 * stylesheet, not in the attribute -- so a caller's `justify-between` cannot
 * reliably beat a `justify-center` emitted here. The only safe hand-over is for
 * the Button not to emit the class at all, which is what `bare` does. Nothing
 * in VARIANT, FOCUS or STATE may set a property listed in DEFAULT_LAYOUT or
 * SIZE; the tests hold every variant to that.
 */
const DEFAULT_LAYOUT = 'inline-flex items-center justify-center font-medium whitespace-nowrap';
const LINK_LAYOUT = 'inline-flex items-center whitespace-nowrap rounded-sm';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app';
const STATE = 'select-none transition-[background-color,border-color,color,filter,transform] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 active:scale-[0.98]';

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
 * destructive action; `link` an action that reads as text; everything else
 * `secondary` or `ghost`. `layout="bare"` hands the shape to `className`.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    layout = 'default',
    touchFloor = true,
    icon,
    loading = false,
    block = false,
    active,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  const isLink = variant === 'link';
  const bare = layout === 'bare';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        !bare && (isLink ? LINK_LAYOUT : DEFAULT_LAYOUT),
        !bare && (isLink ? LINK_SIZE[size] : SIZE[size]),
        touchFloor && isLink && LINK_TOUCH,
        touchFloor && bare && !isLink && 'min-h-11',
        FOCUS,
        STATE,
        VARIANT[variant],
        // After the variant, so a lit control wins over its resting colours.
        active && ACTIVE,
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 16} aria-hidden /> : icon}
      {children}
    </button>
  );
});
