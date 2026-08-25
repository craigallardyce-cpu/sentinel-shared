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
  WindSample,
  WindSampler,
  WaveSample,
  WaveSampler,
  SeaStateOptions,
  MotoringOptions
} from './routing.js';

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
  fetchWaveField,
  createWaveSampler,
  waveToComponents,
  waveFromComponents
} from './waveField.js';
export type { WaveField, WaveFieldOptions } from './waveField.js';

export {
  summarisePassage,
  encounterPeriodS,
  WIND_BANDS_KTS,
  WAVE_BANDS_M
} from './passageSummary.js';
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
