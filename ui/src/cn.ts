/** Join class names, dropping falsy entries (so `cond && 'cls'` just works). */
export function cn(...parts: Array<unknown>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
