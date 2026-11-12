import { Resvg } from '@resvg/resvg-js';
import * as echarts from 'echarts';
import { buildChartOption } from '../../../shared/chart-option.js';

const FONT = { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' };

export function svgToPng(svg, width) {
  return new Resvg(svg, { background: '#ffffff', fitTo: { mode: 'width', value: width }, font: FONT }).render().asPng();
}

export function renderChartPng(chart, table, { width = 960, height = 540 } = {}) {
  const option = buildChartOption(chart, table, { mode: 'image' });
  if (!option) return null;
  const instance = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    instance.setOption({ ...option, animation: false, backgroundColor: '#ffffff', tooltip: undefined });
    return svgToPng(instance.renderToSVGString(), width * 2);
  } finally {
    instance.dispose();
  }
}

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Placeholder CCTV frame for the demo dataset (image_url = demo://frame/N).
export function demoFramePng({ seed = 1, label = 'Violation', time = '' } = {}) {
  const s = Math.abs(Number(seed) || 1);
  const x = 150 + ((s * 53) % 300);
  const y = 110 + ((s * 29) % 50);
  const cam = String((s % 12) + 1).padStart(2, '0');
  const tag = xml(`${label} ${(0.82 + (s % 17) / 100).toFixed(2)}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#3B434A"/>
  <polygon points="0,236 640,206 640,360 0,360" fill="#565F66"/>
  <polygon points="0,300 640,262 640,276 0,316" fill="#C9A227" opacity="0.55"/>
  <rect x="30" y="64" width="130" height="160" fill="#4A535A"/>
  <rect x="30" y="112" width="130" height="5" fill="#5E676E"/><rect x="30" y="164" width="130" height="5" fill="#5E676E"/>
  <rect x="480" y="54" width="130" height="160" fill="#4A535A"/>
  <rect x="480" y="102" width="130" height="5" fill="#5E676E"/><rect x="480" y="154" width="130" height="5" fill="#5E676E"/>
  <circle cx="${x + 30}" cy="${y + 16}" r="14" fill="#C9B8A3"/>
  <rect x="${x + 12}" y="${y + 32}" width="36" height="70" rx="8" fill="#E2833A"/>
  <rect x="${x + 14}" y="${y + 100}" width="12" height="50" fill="#2B3036"/><rect x="${x + 34}" y="${y + 100}" width="12" height="50" fill="#2B3036"/>
  <rect x="${x}" y="${y - 2}" width="60" height="160" fill="none" stroke="#FF3B30" stroke-width="3"/>
  <rect x="${x}" y="${y - 26}" width="${tag.length * 7.6 + 14}" height="22" fill="#FF3B30"/>
  <text x="${x + 7}" y="${y - 10}" font-family="DejaVu Sans" font-size="13" fill="#FFFFFF">${tag}</text>
  <rect x="0" y="0" width="640" height="34" fill="#000000" opacity="0.35"/>
  <circle cx="18" cy="17" r="5" fill="#FF3B30"/>
  <text x="30" y="22" font-family="DejaVu Sans Mono" font-size="14" fill="#E6EAED">CAM ${cam}</text>
  <text x="626" y="22" text-anchor="end" font-family="DejaVu Sans Mono" font-size="14" fill="#E6EAED">${xml(time)}</text>
</svg>`;
  return svgToPng(svg, 960);
}
