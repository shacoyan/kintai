import { useMemo, useState } from 'react';
import type { DailySegmentPoint } from '../../lib/sales/types';
import {
  aggregateByWeekdayPerLocation,
  type LocationSeriesInput,
} from '../../lib/sales/weekdayLocationAggregation';
import WeekdayLocationBarChart from './charts/WeekdayLocationBarChart';
import WeekdayLocationTable from './charts/WeekdayLocationTable';
import { Card } from '../ui';
import { EmptyState } from './ui';
import { MSG } from '../../lib/sales/messages';

interface LocationSeriesProp {
  locationId: string;
  locationName: string;
  dailyTrend: DailySegmentPoint[];
}

interface Props {
  locationSeries: LocationSeriesProp[];
  colorMap: Record<string, string>;
  mode?: 'average' | 'sum';
}

const toggleBase =
  'px-3 py-1 text-sm rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 motion-safe:transition-colors';
const toggleActive = 'bg-primary text-white';
const toggleInactive =
  'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700';

export default function WeekdayLocationAnalysisSection({
  locationSeries,
  colorMap,
  mode,
}: Props) {
  const [selectedMode, setSelectedMode] = useState<'average' | 'sum'>(mode ?? 'average');

  const locationMeta = useMemo(
    () =>
      locationSeries.map((l) => ({
        locationId: l.locationId,
        locationName: l.locationName,
      })),
    [locationSeries],
  );

  const aggregates = useMemo(() => {
    const input: LocationSeriesInput[] = locationSeries.map((l) => ({
      locationId: l.locationId,
      locationName: l.locationName,
      points: l.dailyTrend,
    }));
    return aggregateByWeekdayPerLocation(input, selectedMode);
  }, [locationSeries, selectedMode]);

  const isEmpty = locationSeries.length === 0 || aggregates.every((a) => a.sampleCount === 0);

  return (
    <Card>
      <Card.Header className="flex items-center justify-between gap-3">
        <span>曜日別分析（店舗別）</span>
        <div role="group" aria-label="集計モード切替" className="flex gap-1">
          <button
            type="button"
            onClick={() => setSelectedMode('average')}
            aria-pressed={selectedMode === 'average'}
            className={`${toggleBase} ${selectedMode === 'average' ? toggleActive : toggleInactive}`}
          >
            平均
          </button>
          <button
            type="button"
            onClick={() => setSelectedMode('sum')}
            aria-pressed={selectedMode === 'sum'}
            className={`${toggleBase} ${selectedMode === 'sum' ? toggleActive : toggleInactive}`}
          >
            合計
          </button>
        </div>
      </Card.Header>

      <Card.Body>
        {isEmpty ? (
          <EmptyState title={MSG.empty.weekday} />
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mt-2 mb-2">
              客数（棒グラフ）
            </h3>
            <WeekdayLocationBarChart
              data={aggregates}
              locationSeries={locationMeta}
              colorMap={colorMap}
              metric="customers"
            />

            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mt-4 mb-2">
              客数（テーブル）
            </h3>
            <WeekdayLocationTable data={aggregates} locationSeries={locationMeta} metric="customers" />

            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mt-4 mb-2">
              売上（棒グラフ）
            </h3>
            <WeekdayLocationBarChart
              data={aggregates}
              locationSeries={locationMeta}
              colorMap={colorMap}
              metric="sales"
            />

            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mt-4 mb-2">
              売上（テーブル）
            </h3>
            <WeekdayLocationTable data={aggregates} locationSeries={locationMeta} metric="sales" />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
