import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { Box, Typography, useTheme } from '@mui/material'

const DEFAULT_COLORS = [
  '#4B2C6F', '#1976d2', '#2e7d32', '#ed6c02', '#d32f2f',
  '#0288d1', '#7b1fa2', '#c2185b', '#00838f', '#558b2f',
  '#e65100', '#4527a0', '#ad1457', '#00695c', '#ef6c00',
]

const CostDonutChart = ({
  data = [],        // [{ name, value, color? }]
  width = 280,
  height = 280,
  innerRadiusRatio = 0.55,
  title,
  formatValue,
  showLegend = true,
  totalOverride,    // if set, used for center label and % calculations instead of sum(data)
}) => {
  const svgRef = useRef(null)
  const theme = useTheme()

  const fmt = formatValue || ((v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

  useEffect(() => {
    if (!svgRef.current || !data.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = 10
    const radius = Math.min(width, height) / 2 - margin
    const innerRadius = radius * innerRadiusRatio

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`)

    const pie = d3.pie()
      .value(d => d.value)
      .sort(null)
      .padAngle(0.02)

    const arc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)

    const arcHover = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(radius + 6)

    const arcLabel = d3.arc()
      .innerRadius(radius * 0.75)
      .outerRadius(radius * 0.75)

    const colorScale = (i) => data[i]?.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]

    const sliceTotal = data.reduce((s, d) => s + d.value, 0)
    const total = totalOverride != null ? totalOverride : sliceTotal

    const arcs = g.selectAll('.arc')
      .data(pie(data))
      .enter()
      .append('g')
      .attr('class', 'arc')

    // Slices with animation
    arcs.append('path')
      .attr('d', arc)
      .attr('fill', (d, i) => colorScale(i))
      .attr('stroke', theme.palette.background.paper)
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')
      .on('mouseenter', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', arcHover)
          .attr('opacity', 0.85)

        // Show tooltip
        tooltip
          .style('opacity', 1)
          .html(`<strong>${d.data.name}</strong><br/>${fmt(d.data.value)}<br/>${total > 0 ? ((d.data.value / total) * 100).toFixed(1) : 0}%`)
      })
      .on('mouseleave', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', arc)
          .attr('opacity', 1)

        tooltip.style('opacity', 0)
      })

    // Percentage labels on slices (only if > 5%)
    arcs.append('text')
      .attr('transform', d => `translate(${arcLabel.centroid(d)})`)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('font-size', '11px')
      .style('font-weight', 600)
      .style('fill', '#fff')
      .style('pointer-events', 'none')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .text(d => {
        const pct = total > 0 ? (d.data.value / total) * 100 : 0
        return pct > 5 ? `${pct.toFixed(0)}%` : ''
      })

    // Center total
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '-0.3em')
      .style('font-size', '12px')
      .style('fill', theme.palette.text.secondary)
      .text('Total')

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('dy', '1em')
      .style('font-size', '16px')
      .style('font-weight', 700)
      .style('fill', theme.palette.text.primary)
      .text(fmt(total))

    // Tooltip
    const tooltip = d3.select(svgRef.current.parentNode)
      .selectAll('.donut-tooltip')
      .data([0])
      .join('div')
      .attr('class', 'donut-tooltip')
      .style('position', 'absolute')
      .style('background', 'rgba(0,0,0,0.8)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 10)
      .style('top', '10px')
      .style('right', '10px')
      .style('transition', 'opacity 0.2s')

    // Entrance animation
    arcs.selectAll('path')
      .attr('opacity', 0)
      .transition()
      .duration(600)
      .delay((d, i) => i * 80)
      .attr('opacity', 1)

  }, [data, width, height, innerRadiusRatio, theme, totalOverride])

  if (!data.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary" variant="body2">No data to display</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {title && (
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{title}</Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <svg ref={svgRef} />
        {showLegend && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', maxWidth: width + 40, px: 1 }}>
            {data.map((d, i) => (
              <Box key={d.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{
                  width: 10, height: 10, borderRadius: '50%',
                  bgcolor: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                  flexShrink: 0,
                }} />
                <Typography variant="caption" noWrap sx={{ maxWidth: 100 }}>{d.name}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default CostDonutChart
