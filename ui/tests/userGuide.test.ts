import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  USER_GUIDE_URL,
  USER_GUIDE_ANCHORS,
  USER_GUIDE_APP_SECTION,
  userGuideUrl,
  openUserGuide,
  type UserGuideSection,
} from '../src/userGuide';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('userGuideUrl', () => {
  it('is the website guide, never a bundled copy', () => {
    expect(USER_GUIDE_URL).toBe('https://marinersentinel.com/user-guide.html');
    expect(userGuideUrl()).toBe(USER_GUIDE_URL);
  });

  it('lands on a section by its anchor', () => {
    expect(userGuideUrl('hs-alarms')).toBe('https://marinersentinel.com/user-guide.html#hs-alarms');
  });

  it("gives each app its own chapter", () => {
    expect(userGuideUrl(USER_GUIDE_APP_SECTION.harborsentinel)).toMatch(/#harbor$/);
    expect(userGuideUrl(USER_GUIDE_APP_SECTION.oceansentinel)).toMatch(/#ocean$/);
    expect(userGuideUrl(USER_GUIDE_APP_SECTION.vesselkeeper)).toMatch(/#keeper$/);
  });

  it('drops an unknown section rather than linking to nothing', () => {
    expect(userGuideUrl('nope' as UserGuideSection)).toBe(USER_GUIDE_URL);
    expect(userGuideUrl(null)).toBe(USER_GUIDE_URL);
  });

  it('lists each anchor once', () => {
    expect(new Set(USER_GUIDE_ANCHORS).size).toBe(USER_GUIDE_ANCHORS.length);
  });
});

describe('openUserGuide', () => {
  it('opens the section in the system browser through openExternal', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openUserGuide('vk-maint')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://marinersentinel.com/user-guide.html#vk-maint',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
