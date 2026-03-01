/**
 * Dashboard metrics types for KPI summaries and time-series data.
 *
 * Based on dashboard metrics Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Range and bucket enums
// ---------------------------------------------------------------------------

/** Supported dashboard time range selections. */
export type DashboardRangeKey = '24h' | '3d' | '7d' | '14d' | '1m' | '3m' | '6m' | '1y';

/** Supported dashboard time bucket granularities. */
export type DashboardBucketKey = 'hour' | 'day' | 'week' | 'month';

// ---------------------------------------------------------------------------
// Series point types
// ---------------------------------------------------------------------------

/** Single numeric time-series data point. */
export interface MetricSeriesPoint {
  period: string;
  value: number;
}

/** Work-in-progress data point split by task status buckets. */
export interface MetricWipPoint {
  period: string;
  inbox: number;
  inProgress: number;
  review: number;
  done: number;
}

// ---------------------------------------------------------------------------
// Range series
// ---------------------------------------------------------------------------

/** Series payload for a single range/bucket combination. */
export interface MetricRangeSeries {
  range: DashboardRangeKey;
  bucket: DashboardBucketKey;
  points: MetricSeriesPoint[];
}

/** WIP series payload for a single range/bucket combination. */
export interface MetricWipRangeSeries {
  range: DashboardRangeKey;
  bucket: DashboardBucketKey;
  points: MetricWipPoint[];
}

// ---------------------------------------------------------------------------
// Series sets (primary vs comparison)
// ---------------------------------------------------------------------------

/** Primary vs comparison pair for generic series metrics. */
export interface MetricSeriesSet {
  primary: MetricRangeSeries;
  comparison: MetricRangeSeries;
}

/** Primary vs comparison pair for WIP status series metrics. */
export interface MetricWipSeriesSet {
  primary: MetricWipRangeSeries;
  comparison: MetricWipRangeSeries;
}

// ---------------------------------------------------------------------------
// KPI summary
// ---------------------------------------------------------------------------

/** Topline dashboard KPI summary values. */
export interface DashboardKpis {
  activeAgents: number;
  tasksInProgress: number;
  errorRatePct: number;
  medianCycleTimeHours7d: number | null;
}

// ---------------------------------------------------------------------------
// Complete dashboard response
// ---------------------------------------------------------------------------

/** Complete dashboard metrics response payload. */
export interface DashboardMetrics {
  range: DashboardRangeKey;
  generatedAt: string;
  kpis: DashboardKpis;
  throughput: MetricSeriesSet;
  cycleTime: MetricSeriesSet;
  errorRate: MetricSeriesSet;
  wip: MetricWipSeriesSet;
}

/**
 * Convenience alias for a single time-series line.
 * Can be used as a building block in chart components.
 */
export type MetricTimeSeries = MetricSeriesPoint[];
