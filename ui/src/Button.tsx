import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

/**
 * `primary`, `secondary`, `ghost`, `link`, `danger` and `alarm`.
 *
 * `success` and `accent` are deprecated aliases: `success` draws as `primary`
 * (green is not an action) and `accent` as `secondary`. Both still type-check
 * so no app breaks before it has moved off them.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'link'
  | 'danger'
  | 'alarm'
  /** @deprecated Draws as `primary`. Green is not an action (fit-and-finish X2). */
  | 'success'
  /** @deprecated Draws as `secondary`. Use `active` for a control that is on. */
  | 'accent';
type CanonicalVariant = Exclude<ButtonVariant, 'success' | 'accent'>;
/**
 * `md` is 48px (the default and the touch floor); `sm` is 40px, for dense
 * tables a pointer drives. `dense` is a deprecated alias of `sm`: the 32px
 * size it named is retired, so it renders at 40.
 */
export type ButtonSize =
  | 'sm'
  | 'md'
  /** @deprecated The 32px size is retired; renders as `sm` (40px). */
  | 'dense';
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
   * The 48px touch floor, where the caller has taken over the shape.
   * Defaults to on. It applies to `layout="bare"` (as `min-h-12`) and to the
   * `link` variant (as an invisible 48px-tall hit area that does not move
   * anything). `layout="default"` ignores it: there `size` sets the height.
   * Pass `false` only for a control a mouse drives, or one that already has a
   * 48px-tall parent that is itself the target.
   */
  touchFloor?: boolean;
}

/*
  Six variants (fit-and-finish, 2026-09-30): primary, secondary, ghost, link,
  danger and alarm. Two earlier ones are kept as deprecated aliases, so every
  app keeps compiling until it has moved off them:

  * `success` renders as `primary`. It was a solid green for completions
    (VesselKeeper's "mark done", OceanSentinel's preset save), but green states
    a condition -- "this is fine" -- and an action is not a condition (X2).
    Actions are cyan.

  * `accent` renders as `secondary`. It was a tinted cyan for "a notable action
    that is not THE action"; the design system folds that into secondary, and
    a control that is *on* uses `active`, which also sets `aria-pressed`.

  `alarm` is for acknowledging or silencing an alarm, and nothing else. It is
  not `danger`: `danger` is a destructive action the owner may not have meant,
  drawn dim and outlined to be resistible; acknowledging an anchor-drag alarm
  wants to be the brightest thing on a dark screen at 04:00.

  Nothing glows. State is carried by fill and stroke (System board,
  "Elevation"), so no variant sets a shadow.
*/
const VARIANT: Record<CanonicalVariant, string> = {
  primary: 'bg-cyan text-bg-app hover:brightness-110 active:brightness-95',
  secondary: 'bg-transparent text-text-primary border border-border-color hover:bg-bg-card-hover',
  alarm: 'bg-red text-bg-app hover:brightness-110 active:brightness-95',
  danger: 'bg-red-dim text-red border border-red/40 hover:bg-red/15',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-card-hover',
  // Text that acts: OceanSentinel's "Recentre" and "Install app", HarborSentinel's
  // "Manage plan". No fill at rest or on hover -- `ghost` fills on hover, which
  // is what kept these hand-rolled -- and no padding or height (see LINK_SIZE).
  link: 'bg-transparent text-cyan cursor-pointer hover:underline underline-offset-2',
};

/** What each variant draws as. The two deprecated ones borrow another's classes. */
const VARIANT_ALIAS: Record<ButtonVariant, CanonicalVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
  link: 'link',
  danger: 'danger',
  alarm: 'alarm',
  success: 'primary',
  accent: 'secondary',
};

/**
 * Two heights (fit-and-finish): 48px is the default and the touch floor for
 * wet and gloved hands; 40px is for dense tables a pointer drives. Labels are
 * Inter 15/600 at both, so the two sizes differ in height and padding only.
 *
 * `dense` was 32px. That size is retired and renders at 40, as `sm` does, so
 * nothing that asked for it gets smaller. It keeps its old 8px side padding,
 * because the callers that still use it include square icon buttons sized by
 * a `w-8` of their own (OceanSentinel's panel close buttons), which `sm`'s
 * padding would squeeze to nothing. `md` was 44px and is 48 now.
 */
const SIZE: Record<ButtonSize, string> = {
  md: 'h-12 px-5 text-[15px] gap-2 rounded-md',
  sm: 'h-10 px-4 text-[15px] gap-2 rounded-md',
  dense: 'h-10 px-2 text-[15px] gap-2 rounded-md',
};

/**
 * `link` takes only the type size and icon gap from `size`: padding and a
 * 48px height are what would relayout a status bar the link sits in. Its
 * touch target comes from LINK_TOUCH instead. No font weight either, so it
 * inherits the text around it and a caller's `font-bold` has nothing to fight.
 */
const LINK_SIZE: Record<ButtonSize, string> = {
  md: 'text-[15px] gap-2',
  sm: 'text-[15px] gap-2',
  dense: 'text-[15px] gap-2',
};

/**
 * A link's 48px touch target, drawn as an invisible `::before` centred on the
 * text, so the hit area grows and the layout does not. The `relative` it needs
 * is the one layout class a link emits: a caller who positions a link with
 * `absolute` or `fixed` should pass `touchFloor={false}` and give the parent
 * the height instead.
 */
const LINK_TOUCH = "relative before:absolute before:inset-x-0 before:top-1/2 before:h-12 before:-translate-y-1/2 before:content-['']";

/**
 * What `layout` controls. `cn` concatenates rather than merging Tailwind, and
 * two classes setting the same property resolve by their order in the
 * stylesheet, not in the attribute -- so a caller's `justify-between` cannot
 * reliably beat a `justify-center` emitted here. The only safe hand-over is for
 * the Button not to emit the class at all, which is what `bare` does. Nothing
 * in VARIANT, FOCUS or STATE may set a property listed in DEFAULT_LAYOUT or
 * SIZE; the tests hold every variant to that.
 *
 * Labels are Inter at 600 in sentence case: `font-sans`, so a button inside a
 * mono block does not inherit mono, and no casing or tracking of its own.
 */
const DEFAULT_LAYOUT = 'inline-flex items-center justify-center font-sans font-semibold whitespace-nowrap';
const LINK_LAYOUT = 'inline-flex items-center whitespace-nowrap rounded-md';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app';
const STATE =
  'select-none transition-[background-color,border-color,color,filter] duration-[var(--motion-state)] ease-[var(--motion-ease)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100';

/**
 * The lit state, matching @sentinel/theme's `.glass-btn-active`, which the
 * header and dock already use -- so a toggled Button and a toggled dock item
 * read as the same thing. A fill and a stroke; no glow.
 */
const ACTIVE = 'bg-cyan-dim border border-cyan text-cyan hover:bg-cyan-dim';

/**
 * The fleet button. Labels are sentence case ("Save and apply", not "SAVE AND
 * APPLY"), Inter 15/600, on every variant.
 *
 * `primary` is the one main action on a surface; `alarm` acknowledging an
 * alarm; `danger` a destructive action; `link` an action that reads as text;
 * everything else `secondary` or `ghost`. `layout="bare"` hands the shape to
 * `className`.
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
  const drawn = VARIANT_ALIAS[variant] ?? 'secondary';
  const isLink = drawn === 'link';
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
        touchFloor && bare && !isLink && 'min-h-12',
        FOCUS,
        STATE,
        VARIANT[drawn],
        // After the variant, so a lit control wins over its resting colours.
        active && ACTIVE,
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={16} aria-hidden /> : icon}
      {children}
    </button>
  );
});
