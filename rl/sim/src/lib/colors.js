/* Consistent energy-type color tokens used across all components. */

export const ENERGY = {
  solar:       { main: '#f59e0b', light: '#fef3c7', dark: '#92400e', label: 'Solar PV' },
  battery:     { main: '#0d9488', light: '#ccfbf1', dark: '#134e4a', label: 'Battery' },
  grid:        { main: '#6366f1', light: '#e0e7ff', dark: '#3730a3', label: 'Grid' },
  consumption: { main: '#ef4444', light: '#fee2e2', dark: '#991b1b', label: 'Consumption' },
  generation:  { main: '#10b981', light: '#d1fae5', dark: '#065f46', label: 'Generation' },
  cooling:     { main: '#3b82f6', light: '#dbeafe', dark: '#1e40af', label: 'Cooling' },
  dhw:         { main: '#ec4899', light: '#fce7f3', dark: '#9d174d', label: 'DHW' },
  carbon:      { main: '#8b5cf6', light: '#ede9fe', dark: '#5b21b6', label: 'Carbon' },
  price:       { main: '#f97316', light: '#ffedd5', dark: '#9a3412', label: 'Price' },
  temperature: { main: '#f97316', light: '#ffedd5', dark: '#9a3412', label: 'Temperature' },
};

export const BUILDING_PALETTE = [
  '#6366f1', // indigo
  '#0d9488', // teal
  '#f59e0b', // amber
  '#ef4444', // red
  '#10b981', // emerald
  '#ec4899', // pink
];

export const CHART_GRID = '#f1f5f9';
export const CHART_TEXT = '#94a3b8';
