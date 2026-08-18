/** How a layer reads, so overlays drawn on top can pick a contrasting colour. */
export type ProviderBackground = 'light' | 'dark' | 'transparent';

/** Mutually exclusive background, or something drawn over one. */
export type ProviderKind = 'base' | 'overlay';

/**
 * How much weight the data carries.
 *
 * `official`   a national hydrographic office. Highest trust, and the only tier whose
 *              rendering is derived from surveyed chart data.
 * `commercial` licensed cartography from a vendor.
 * `reference`  imagery or crowd-sourced data. No hydrographic standing.
 */
export type ProviderAuthority = 'official' | 'commercial' | 'reference';

/** A degrees bounding box. */
export interface CoverageBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TileOptions {
  /** Render soundings in metres rather than feet. Only meaningful for chart services. */
  useMetric?: boolean;
}

/**
 * An exact coverage test, used where a bounding box is too coarse to be trusted.
 * Returns `null` when it cannot answer yet, so the caller falls back to the boxes.
 */
export type CoverageTest = (lat: number, lon: number) => boolean | null;

export interface ChartProvider {
  /**
   * Stable key. Appears in tile URLs and is persisted as the user's selected layer, so
   * renaming one silently resets a preference.
   */
  id: string;
  label: string;
  kind: ProviderKind;
  authority: ProviderAuthority;
  background: ProviderBackground;
  /** `null` means worldwide. */
  coverage: CoverageBox[] | null;
  /** Required credit. Several sources licence on the condition that this is displayed. */
  attribution: string;
  maxZoom: number;
  /** Sent upstream where a service expects it. Omit unless the provider needs one. */
  referer?: string;
  /** Exact coverage test, preferred over `coverage` when present. */
  covers?: CoverageTest;
  /** `null` for providers that render nothing, such as a deliberate blank background. */
  build: ((z: number, x: number, y: number, opts?: TileOptions) => string) | null;
}

/** The serialisable view sent to clients — omits functions and anything server-side. */
export interface ProviderDescriptor {
  id: string;
  label: string;
  kind: ProviderKind;
  authority: ProviderAuthority;
  background: ProviderBackground;
  coverage: CoverageBox[] | null;
  attribution: string;
  maxZoom: number;
  renders: boolean;
}

export interface RegistryOptions {
  /**
   * MapTiler API key. When absent the licensed basemaps are withdrawn and the unlicensed
   * development fallbacks take their place — see the registry docs for why that matters.
   */
  maptilerKey?: string;
  /**
   * Optional exact coverage test for NOAA cells, supplied by hosts that carry the ENC
   * catalog. Hosts without one fall back to bounding boxes.
   */
  noaaCellCoverage?: CoverageTest;
  /** Provider used when nothing of higher authority covers a position. */
  fallbackId?: string;
}

export interface ChartRegistry {
  /** Every provider defined, regardless of whether it is currently usable. */
  all: ChartProvider[];
  /** Those usable given the configuration — what callers should serve and display. */
  active: ChartProvider[];
  hasLicensedBasemap: boolean;
  getProvider(id: string): ChartProvider | null;
  /** Best base layer for a position: official charts where they exist, imagery elsewhere. */
  selectBaseProvider(lat: number, lon: number): ChartProvider | null;
  /** Client-safe descriptors for the active set. */
  describe(): ProviderDescriptor[];
}
