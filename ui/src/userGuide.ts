import { openExternal } from './openExternal';
import { userGuideUrl, type UserGuideSection } from './userGuideSections';

export * from './userGuideSections';

/** Open the guide in the system browser at `section`. Returns what `openExternal` returns. */
export function openUserGuide(section?: UserGuideSection | null): boolean {
  return openExternal(userGuideUrl(section));
}
