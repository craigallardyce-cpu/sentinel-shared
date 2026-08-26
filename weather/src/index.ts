export {
  isInsideNwsCoverage,
  formatPosition,
  getOpenMeteoForecast,
  clearForecastCache
} from './openMeteo.js';
export type { MarineForecast, ForecastPeriod, ForecastOptions } from './openMeteo.js';

export {
  boatSpeed,
  foldTwa,
  bestVmg,
  parsePolarFile,
  GENERIC_POLARS
} from './polars.js';
export type { PolarDiagram, VmgResult } from './polars.js';

export {
  routeIsochrone,
  distanceNm,
  bearingDeg,
  destinationPoint,
  angleBetween,
  seaStateFactor
} from './routing.js';
export type {
  RouteOptions,
  RouteResult,
  RouteLeg,
  RouteFront,
  FrontPoint,
  WindSample,
  WindSampler,
  WaveSample,
  WaveSampler,
  CurrentSample,
  CurrentSampler,
  SeaStateOptions,
  MotoringOptions,
  Propulsion,
  FuelOptions
} from './routing.js';

export {
  powerPolar,
  powerSeaState,
  powerRangeFrom,
  windageLossFraction,
  isUsablePowerProfile
} from './powerPerformance.js';
export type { PowerProfile, PowerRange } from './powerPerformance.js';

export { compareSecondOpinion } from './secondOpinion.js';
export type { SecondOpinion, DepartureOutcome } from './secondOpinion.js';

export { createObstacleField, userZone, landZones } from './obstacles.js';
export type { ObstacleField, ObstacleZone, ObstacleRing } from './obstacles.js';

export {
  fetchWindField,
  createWindSampler,
  boundsForPassage,
  toComponents,
  fromComponents
} from './windField.js';
export type { WindField, WindFieldOptions, Bounds } from './windField.js';

export {
  fetchMarineField,
  createWaveSampler,
  createCurrentSampler,
  waveToComponents,
  waveFromComponents,
  currentToComponents,
  currentFromComponents,
  speedToKnots
} from './marineField.js';
export type { MarineField, MarineFieldOptions } from './marineField.js';

export {
  summarisePassage,
  encounterPeriodS,
  WIND_BANDS_KTS,
  WAVE_BANDS_M
} from './passageSummary.js';

export { solarElevationDeg, isNightAt, NIGHT_ELEVATION_DEG } from './sun.js';

export { scanHazards, buildCorridor, buildAdvisory, compareToPlan } from './corridor.js';
export type {
  Hazard,
  HazardScan,
  HazardLimits,
  Corridor,
  CorridorBand,
  Advisory,
  Samplers,
  PlanCheckpoint,
  PlanSegment,
  PlanComparison,
  SegmentVerdict
} from './corridor.js';
export type { PassageSummary, Band, SummaryOptions } from './passageSummary.js';

export {
  createPolarAccumulator,
  addSample,
  derivePolar,
  mergeAccumulators,
  trueWindAngle,
  toPolFile,
  serializeAccumulator,
  deserializeAccumulator
} from './polarLearning.js';
export type {
  PolarAccumulator,
  PolarBin,
  TelemetrySample,
  AddSampleResult,
  RejectionReason,
  LearningOptions,
  DeriveOptions,
  DerivedPolar,
  PolarCoverage,
  CoverageCell
} from './polarLearning.js';
