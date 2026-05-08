// ---------------------------------------------------------------------------
// ECharts core registration (tree-shaken).
// ---------------------------------------------------------------------------
// Importamos solo los chart types y componentes que el Command Center usa,
// para mantener el bundle alrededor de ~150KB en vez de los ~800KB del
// bundle completo de `echarts`. El resto del proyecto consume `echarts`
// SIEMPRE a través de `import { echarts } from '@/lib/charts/setup'` para
// que el tree-shake funcione.
// ---------------------------------------------------------------------------

import * as echarts from 'echarts/core';
import {
  BarChart,
  CustomChart,
  GaugeChart,
  LineChart,
  TreemapChart,
} from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  // charts
  BarChart,
  CustomChart,
  GaugeChart,
  LineChart,
  TreemapChart,
  // components
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  // renderer
  CanvasRenderer,
]);

export { echarts };
