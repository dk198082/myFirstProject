import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis } from 'recharts';
import * as C from '../../components/ui/chart';
import { Stack } from '../parts';

const examples = [
  { label: 'A', scheduled: 12, remaining: 8 },
  { label: 'B', scheduled: 18, remaining: 10 },
  { label: 'C', scheduled: 15, remaining: 6 },
];
const config = {
  scheduled: { label: 'Scheduled', color: 'var(--color-chart-1)' },
  remaining: { label: 'Remaining', color: 'var(--color-chart-2)' },
};

export function ChartDemo() {
  return <Stack label="Illustrative chart data · not live board quantities">
    {(['dot', 'line', 'dashed'] as const).map(indicator =>
      <section key={indicator} className="rounded-sm border p-4">
        <p className="mb-3 text-xs text-muted-foreground">Tooltip indicator: {indicator}</p>
        <C.ChartContainer config={config} className="h-64 w-full">
          <BarChart data={examples} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <C.ChartTooltip content={<C.ChartTooltipContent indicator={indicator} />} />
            <C.ChartLegend content={<C.ChartLegendContent />} />
            <Bar dataKey="scheduled" fill="var(--color-scheduled)" />
            <Bar dataKey="remaining" fill="var(--color-remaining)" />
          </BarChart>
        </C.ChartContainer>
      </section>,
    )}
    <C.ChartContainer config={config} className="h-64 w-full">
      <LineChart data={examples} accessibilityLayer>
        <XAxis dataKey="label" />
        <C.ChartTooltip content={<C.ChartTooltipContent hideLabel hideIndicator />} />
        <C.ChartLegend content={<C.ChartLegendContent hideIcon />} />
        <Line dataKey="scheduled" stroke="var(--color-scheduled)" isAnimationActive={false} />
        <Line dataKey="remaining" stroke="var(--color-remaining)" isAnimationActive={false} />
      </LineChart>
    </C.ChartContainer>
  </Stack>;
}
