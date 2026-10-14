// Semantic color tokens that adapt to light/dark mode
// Use: const tc = getSemanticColors(theme) in any component with useTheme()
export const getSemanticColors = (theme) => {
  const isDark = theme.palette.mode === 'dark'
  return {
    // Table header backgrounds (replaces #f5f5f5, #f8f9fa)
    tableHeaderBg: isDark ? '#2a2a2a' : '#f5f5f5',
    tableHeaderText: isDark ? '#ffffff' : 'rgba(0, 0, 0, 0.87)',
    // Even-row striping (replaces #f8f9fa)
    tableStripeBg: isDark ? '#2a2a2a' : '#f8f9fa',
    // Hover (replaces #e9ecef)
    tableHoverBg: isDark ? '#3a3a3a' : '#e9ecef',
    // Default part-type chip fallback (replaces #6c757d)
    chipFallbackBg: isDark ? '#555' : '#f8f9fa',
    chipFallbackColor: isDark ? '#ddd' : '#6c757d',
    chipFallbackBorder: isDark ? '#777' : '#dee2e6',
    // Warning accent (replaces #fff3e0 / #e65100)
    warningAccentBg: isDark ? 'rgba(237, 108, 2, 0.15)' : '#fff3e0',
    warningAccentText: isDark ? '#ffb74d' : '#e65100',
    // Star/highlight icon color (replaces #ff9800)
    highlightIcon: isDark ? '#ffb74d' : '#ff9800',
    // Link blue (replaces #1565c0)
    linkBlue: isDark ? '#90caf9' : '#1565c0',
    // Purple chip (replaces #6f42c1)
    purpleChip: isDark ? '#b39ddb' : '#6f42c1',
    purpleChipDark: isDark ? '#9575cd' : '#5a32a3',
    // Error/red backgrounds (replaces #ffebee, #fff3f3)
    errorHeaderBg: isDark ? 'rgba(244, 67, 54, 0.15)' : '#ffebee',
    errorRowBg: isDark ? 'rgba(244, 67, 54, 0.08)' : '#fff3f3',
    // Empty state background (replaces #f5f5f5 for empty boxes)
    emptyStateBg: isDark ? '#1e1e1e' : '#f5f5f5',
    // Info/blue light backgrounds (replaces #e7f1ff, #e3f2fd)
    infoLightBg: isDark ? 'rgba(25, 118, 210, 0.12)' : '#e7f1ff',
    // Subtle surface for boxes/cards (replaces rgba(0,0,0,0.02))
    subtleSurface: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  }
}
