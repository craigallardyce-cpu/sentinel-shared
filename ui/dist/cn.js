/** Join class names, dropping falsy entries (so `cond && 'cls'` just works). */
export function cn(...parts) {
    return parts.filter((p) => typeof p === 'string' && p.length > 0).join(' ');
}
