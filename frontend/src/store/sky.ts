import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { STARS, CONSTELLATIONS } from '../data/stars'
import type { Star } from '../types'

export const useSkyStore = defineStore('sky', () => {
  const viewDate = ref(new Date())
  const zoom = ref(1.0)
  const panX = ref(0)
  const panY = ref(0)
  const showLabels = ref(true)
  const showConstLines = ref(true)
  const showGrid = ref(true)
  const selectedStar = ref<Star | null>(null)
  const searchQuery = ref('')
  const latitude = ref(39.9) // Beijing default

  const localSiderealTime = computed(() => {
    const d = viewDate.value
    const jd = d.getTime() / 86400000 + 2440587.5
    const T = (jd - 2451545.0) / 36525.0
    let lst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000)
    lst = ((lst % 360) + 360) % 360
    return lst / 15 // convert to hours
  })

  const filteredStars = computed(() => {
    if (!searchQuery.value) return []
    const q = searchQuery.value.toLowerCase()
    return STARS.filter(s => s.name.toLowerCase().includes(q)).slice(0, 5)
  })

  // Single source of truth: RA/Dec -> horizontal coords for the current
  // viewDate + latitude. Canvas, visibility list and detail panel all
  // derive from this so they can never disagree.
  function altAz(ra: number, dec: number): { alt: number; az: number } {
    const ha = (localSiderealTime.value - ra) * 15 * Math.PI / 180
    const decRad = dec * Math.PI / 180
    const latRad = latitude.value * Math.PI / 180

    const alt = Math.asin(Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(ha))
    const az = Math.atan2(-Math.cos(decRad) * Math.sin(ha), Math.sin(decRad) * Math.cos(latRad) - Math.cos(decRad) * Math.sin(latRad) * Math.cos(ha))

    return { alt: alt * 180 / Math.PI, az: (az * 180 / Math.PI + 360) % 360 }
  }

  function isVisible(ra: number, dec: number): boolean {
    return altAz(ra, dec).alt > 0
  }

  const visibleConstellations = computed(() =>
    CONSTELLATIONS
      .map(c => ({
        ...c,
        visibleStars: c.stars.filter(i => isVisible(STARS[i].ra, STARS[i].dec)).length
      }))
      .filter(c => c.visibleStars > 0)
  )

  const selectedStarAltAz = computed(() => {
    const s = selectedStar.value
    return s ? altAz(s.ra, s.dec) : null
  })

  function projectStar(ra: number, dec: number, cx: number, cy: number, scale: number): [number, number] {
    const { alt, az } = altAz(ra, dec)
    const altRad = alt * Math.PI / 180
    const azRad = az * Math.PI / 180

    if (altRad < -0.1) return [-999, -999] // below horizon

    const r = (Math.PI / 2 - altRad) * scale * 0.45
    const x = cx + panX.value + r * Math.sin(azRad)
    const y = cy + panY.value - r * Math.cos(azRad)
    return [x, y]
  }

  function starRadius(mag: number): number {
    return Math.max(1, 5 - mag) * zoom.value
  }

  function spectralColor(spectral: string): string {
    const colors: Record<string, string> = {
      'O': '#9bb0ff', 'B': '#aabfff', 'A': '#cad7ff',
      'F': '#f8f7ff', 'G': '#fff4ea', 'K': '#ffd2a1', 'M': '#ffcc6f'
    }
    return colors[spectral] || '#ffffff'
  }

  function selectStar(x: number, y: number, cx: number, cy: number, scale: number) {
    let closest: Star | null = null
    let minDist = 20
    for (const star of STARS) {
      const [sx, sy] = projectStar(star.ra, star.dec, cx, cy, scale)
      const dist = Math.hypot(sx - x, sy - y)
      if (dist < minDist) { minDist = dist; closest = star }
    }
    selectedStar.value = closest
  }

  return {
    viewDate, zoom, panX, panY, showLabels, showConstLines, showGrid,
    selectedStar, searchQuery, latitude, localSiderealTime, filteredStars,
    altAz, isVisible, visibleConstellations, selectedStarAltAz,
    projectStar, starRadius, spectralColor, selectStar,
    STARS, CONSTELLATIONS
  }
})
