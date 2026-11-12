import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { buildChartOption } from '@shared/chart-option.js';
import { prettyColumn } from '../lib/format.js';
import { useTheme } from '../lib/theme.js';

echarts.use([BarChart, LineChart, PieChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const words = (name) => prettyColumn(name).toLowerCase();
const describe = (chart) => (chart?.type
  ? `${prettyColumn(chart.type)} chart of ${(chart.y || []).map(words).join(' and ')} by ${words(chart.x)}`
  : 'Chart of the answer');

const Chart = forwardRef(function Chart({ chart, table, height = 300, label }, ref) {
  const el = useRef(null);
  const instance = useRef(null);
  const { theme } = useTheme();
  // Narrow charts (phones, split views) lay bars out horizontally so every label fits.
  // Unknown (null) until measured, so the first draw already uses the right layout.
  const [compact, setCompact] = useState(null);

  // Exports sit on the same surface as the card the chart is drawn on.
  useImperativeHandle(ref, () => ({
    toPng: () => instance.current?.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: getComputedStyle(el.current).getPropertyValue('--surface').trim() || '#FFFFFF',
    }),
  }), []);

  useLayoutEffect(() => {
    const chartInstance = echarts.init(el.current, null, { renderer: 'canvas' });
    instance.current = chartInstance;
    setCompact(el.current.clientWidth < 560);
    const observer = new ResizeObserver(([entry]) => {
      chartInstance.resize();
      setCompact(entry.contentRect.width < 560);
    });
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chartInstance.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    if (compact === null) return;
    const option = buildChartOption(chart, table, { dark: theme === 'dark', compact });
    if (option) instance.current?.setOption(option, true);
  }, [chart, table, theme, compact]);

  return <div ref={el} className="chart" style={{ height }} role="img" aria-label={label || chart?.title || describe(chart)} />;
});

export default Chart;
