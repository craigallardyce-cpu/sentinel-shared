import { type UserGuideSection } from './userGuideSections';
export * from './userGuideSections';
/** Open the guide in the system browser at `section`. Returns what `openExternal` returns. */
export declare function openUserGuide(section?: UserGuideSection | null): boolean;
