import { openExternal } from './openExternal';
import { userGuideUrl } from './userGuideSections';
export * from './userGuideSections';
/** Open the guide in the system browser at `section`. Returns what `openExternal` returns. */
export function openUserGuide(section) {
    return openExternal(userGuideUrl(section));
}
