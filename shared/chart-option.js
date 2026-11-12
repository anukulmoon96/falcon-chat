// Builds an Apache ECharts option from Falcon's chart spec + table.
// Shared by the web app (live charts) and the server (PNG charts for WhatsApp/Teams),
// so a chart looks the same on every channel.

// Categorical order validated for color-vision deficiency in both modes (adjacent pairs);
// red is left out because it means violations. Single-series bars use slot 1 with the
// largest value picked out in the brand amber.
const SERIES = ['#3779B1', '#E29F2B', '#A8547C', '#2CA494', '#9F5526', '#619A5B', '#7666B2', '#888C3B'];
const SERIES_DARK = ['#4A8BC5', '#C18510', '#A8547C', '#2CA494', '#9F5526', '#619A5B', '#8878C5', '#828634'];
const HIGHLIGHT = { light: '#F2A900', dark: '#E5A928' };
// Semantic heat (more alerts = hotter) with lightness that changes steadily in both modes;
// the dark mid-stop leans orange so the in-between shades don't turn olive.
const HEAT = { light: ['#FBF4E2', '#EBA93A', '#C4362C'], dark: ['#262B31', '#B0682E', '#EE7B6C'] };
// Chart chrome follows the portal's tokens (styles.css), so charts sit quietly on their cards.
const CHROME = {
  light: { surface: '#FFFFFF', ink: '#5C6670', label: '#46505B', strong: '#1F262E', grid: '#E9ECEF', axis: '#CDD3D9', pointer: 'rgba(31, 38, 46, 0.05)' },
  dark: { surface: '#1A1E23', ink: '#8F99A3', label: '#AEB6BE', strong: '#DCE1E6', grid: '#262C33', axis: '#3A424B', pointer: 'rgba(220, 225, 230, 0.05)' },
};
const FONT = "'IBM Plex Sans', 'DejaVu Sans', system-ui, sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const CHART_TYPES = ['bar', 'line', 'pie', 'heatmap'];

const uniq = (values) => [...new Set(values)];
const label = (v) => (v === null || v === undefined || v === '' ? '(none)' : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pretty = (name) => String(name).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
// 2026-10-05 -> Oct 5, for day-by-day axes
const shortDay = (v) => `${MONTHS[Number(v.slice(5, 7)) - 1]} ${Number(v.slice(8, 10))}`;

export function isChartable(chart, table) {
  return Boolean(chart && CHART_TYPES.includes(chart.type) && table?.rows?.length && buildChartOption(chart, table));
}

// compact: the chart is drawn narrow (a phone, a split view), so bars go horizontal earlier.
export function buildChartOption(chart, table, { dark = false, mode = 'web', compact = false } = {}) {
  if (!chart || !CHART_TYPES.includes(chart.type) || !table?.rows?.length) return null;
  const names = new Set(table.columns.map((c) => c.name));
  const x = names.has(chart.x) ? chart.x : null;
  const ys = (chart.y || []).filter((c) => names.has(c));
  if (!x || !ys.length) return null;

  const tone = dark ? 'dark' : 'light';
  const c = CHROME[tone];
  const fontSize = mode === 'image' ? 15 : 12;
  const rows = table.rows.slice(0, mode === 'image' ? 40 : 500);
  const multi = Boolean(chart.series && names.has(chart.series)) || ys.length > 1;
  const tooltip = {
    backgroundColor: c.surface,
    borderColor: c.axis,
    borderWidth: 1,
    padding: [8, 12],
    transitionDuration: 0,
    textStyle: { fontFamily: FONT, color: c.strong, fontSize: 12 },
    extraCssText: `border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, ${dark ? 0.4 : 0.1});`,
  };

  const base = {
    color: dark ? SERIES_DARK : SERIES,
    textStyle: { fontFamily: FONT, color: c.ink, fontSize },
    // On the web the axis labels line up with the card's text edge; images keep a margin.
    grid: { left: mode === 'image' ? 8 : 0, right: mode === 'image' ? 32 : 24, top: multi ? 44 : 16, bottom: 8, containLabel: true },
    tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.pointer } } },
    legend: multi ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: c.label, fontSize } } : undefined,
    // Charts appear as they are; nothing grows in when a view opens or the theme changes.
    animation: false,
  };
  const axis = {
    axisLine: { lineStyle: { color: c.axis } },
    axisTick: { show: false },
    axisLabel: { color: c.ink, fontSize, hideOverlap: true },
    splitLine: { lineStyle: { color: c.grid } },
  };

  if (chart.type === 'pie') {
    const y = ys[0];
    return {
      ...base,
      tooltip: { ...tooltip, trigger: 'item' },
      legend: { type: 'scroll', bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: c.label, fontSize } },
      series: [{
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: c.surface, borderWidth: 2 },
        emphasis: { scale: false },
        label: { color: c.label, fontSize, formatter: '{b}: {d}%' },
        labelLine: { lineStyle: { color: c.axis } },
        data: rows.map((r) => ({ name: label(r[x]), value: num(r[y]) })),
      }],
    };
  }

  if (chart.type === 'heatmap') {
    if (!chart.series || !names.has(chart.series)) return null;
    const y = ys[0];
    const xs = uniq(rows.map((r) => label(r[x])));
    const ss = uniq(rows.map((r) => label(r[chart.series])));
    const data = rows.map((r) => [xs.indexOf(label(r[x])), ss.indexOf(label(r[chart.series])), num(r[y])]);
    const max = Math.max(1, ...data.map((d) => d[2]));
    return {
      ...base,
      legend: undefined,
      tooltip: { ...tooltip, position: 'top' },
      grid: { ...base.grid, top: 16, bottom: 56 },
      xAxis: { type: 'category', data: xs, ...axis, splitArea: { show: false } },
      yAxis: { type: 'category', data: ss, ...axis },
      visualMap: {
        min: 0, max, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 12,
        text: [String(max), '0'], textGap: 8,
        inRange: { color: HEAT[tone] }, textStyle: { color: c.ink, fontSize },
      },
      series: [{
        type: 'heatmap',
        // On the web a halo in the surface color keeps the numbers legible on every shade of
        // the ramp. The PNG renderer paints a halo over the text, so images instead switch to
        // white numbers on the darkest cells.
        data: mode === 'image' ? data.map((d) => ({ value: d, label: { color: d[2] / max >= 0.8 ? '#FFFFFF' : c.strong } })) : data,
        label: {
          show: xs.length * ss.length <= 60, color: c.strong, fontSize,
          ...(mode === 'image' ? {} : { textBorderColor: c.surface, textBorderWidth: 2 }),
        },
        itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 2 },
      }],
    };
  }

  // bar and line
  const isLine = chart.type === 'line';
  let categories;
  let series;
  if (chart.series && names.has(chart.series)) {
    const y = ys[0];
    categories = uniq(rows.map((r) => label(r[x])));
    const groups = uniq(rows.map((r) => label(r[chart.series]))).slice(0, 8);
    const cell = new Map(rows.map((r) => [`${label(r[x])}\u0000${label(r[chart.series])}`, num(r[y])]));
    series = groups.map((g) => ({ name: g, type: chart.type, data: categories.map((cat) => cell.get(`${cat}\u0000${g}`) ?? 0) }));
  } else {
    categories = rows.map((r) => label(r[x]));
    series = ys.map((y) => ({ name: pretty(y), type: chart.type, data: rows.map((r) => num(r[y])) }));
  }

  const horizontal = !isLine && (categories.length > 8 || categories.some((cat) => cat.length > 14) || (compact && categories.length > 4));
  for (const s of series) {
    if (isLine) {
      Object.assign(s, {
        symbol: 'circle',
        symbolSize: 7,
        // Markers only on short series; long ones show the point under the pointer.
        showSymbol: categories.length <= 14,
        itemStyle: { borderColor: c.surface, borderWidth: 2 },
        lineStyle: { width: 2 },
        areaStyle: series.length === 1 ? { opacity: 0.1 } : undefined,
      });
    } else {
      Object.assign(s, { barMaxWidth: mode === 'image' ? 32 : 24, itemStyle: { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } });
    }
  }
  if (!isLine && series.length === 1) {
    const max = Math.max(...series[0].data);
    series[0].data = series[0].data.map((v) => (v === max && max > 0 ? { value: v, itemStyle: { color: HIGHLIGHT[tone] } } : v));
  }

  const dates = categories.length > 1 && categories.every((cat) => ISO_DAY.test(cat));
  const category = {
    type: 'category',
    data: categories,
    ...axis,
    axisLabel: dates ? { ...axis.axisLabel, formatter: shortDay } : axis.axisLabel,
  };
  const value = { type: 'value', ...axis, axisLine: { show: false } };
  const tip = isLine ? { ...base.tooltip, axisPointer: { type: 'line', lineStyle: { color: c.axis, type: 'solid' } } } : base.tooltip;
  if (horizontal) {
    return { ...base, tooltip: tip, xAxis: value, yAxis: { ...category, inverse: true }, series };
  }
  return { ...base, tooltip: tip, xAxis: { ...category, boundaryGap: !isLine }, yAxis: value, series };
}
