import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { STARS, CONSTELLATIONS } from '../data/stars'
import type { Star } from '../types'

// 观测点固定为北京（与默认纬度配套）。时间框按用户本地时区填写，
// 恒星时、星座可见性、画布投影与选中态全部以这里的 (时刻, 经度, 纬度) 为唯一数据源。
const LONGITUDE = 116.4 // 东经为正，北京

// 高度角 >= 0（地平线以上）即视为可见，星座列表与画布共用同一阈值。
const HORIZON_ALT = 0

const STORAGE_KEY = 'starmap/state/v1'

interface PersistedState {
  viewDate?: string
  latitude?: number
  zoom?: number
  panX?: number
  panY?: number
  showLabels?: boolean
  showConstLines?: boolean
  showGrid?: boolean
  selectedStar?: string | null
}

function loadPersisted(): PersistedState | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as PersistedState | null
  } catch {
    return null
  }
}

function restoreDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function restoreNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback
}

function restoreBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

// datetime-local 控件无时区概念：统一按用户本地时区读写绝对时刻，
// 不再走 toISOString()（UTC），避免 UTC+8 用户看到整体 8 小时偏差。
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatLocalDatetime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function parseLocalDatetime(v: string): Date | null {
  if (!v) return null
  const d = new Date(v) // 按本地时区解析
  return Number.isNaN(d.getTime()) ? null : d
}

export interface HorizontalPosition {
  alt: number // 高度角（弧度）
  az: number  // 方位角（弧度，自北向东）
  visible: boolean // 是否位于地平线以上
}

export const useSkyStore = defineStore('sky', () => {
  const persisted = loadPersisted()

  const viewDate = ref(restoreDate(persisted?.viewDate) ?? new Date())
  const zoom = ref(restoreNum(persisted?.zoom, 0.3, 3, 1.0))
  const panX = ref(restoreNum(persisted?.panX, -10000, 10000, 0))
  const panY = ref(restoreNum(persisted?.panY, -10000, 10000, 0))
  const showLabels = ref(restoreBool(persisted?.showLabels, true))
  const showConstLines = ref(restoreBool(persisted?.showConstLines, true))
  const showGrid = ref(restoreBool(persisted?.showGrid, true))
  const latitude = ref(restoreNum(persisted?.latitude, -90, 90, 39.9)) // 北京默认
  const longitude = ref(LONGITUDE)
  const searchQuery = ref('')
  const selectedStar = ref<Star | null>(
    persisted?.selectedStar ? STARS.find(s => s.name === persisted.selectedStar) ?? null : null
  )

  // 本地恒星时（小时）：GMST + 观测点经度。时刻或纬度之外的唯一时间换算入口。
  const localSiderealTime = computed(() => {
    const d = viewDate.value
    const jd = d.getTime() / 86400000 + 2440587.5
    const T = (jd - 2451545.0) / 36525.0
    const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000)
    const lst = (((gmst + longitude.value) % 360) + 360) % 360
    return lst / 15 // 角度 -> 小时
  })

  const filteredStars = computed(() => {
    if (!searchQuery.value) return []
    const q = searchQuery.value.toLowerCase()
    return STARS.filter(s => s.name.toLowerCase().includes(q)).slice(0, 5)
  })

  // 赤道坐标 (ra 小时 / dec 度) -> 地平坐标。
  // 画布投影、星座可见性、选中天体可见性全部共用这一个换算，
  // 时刻(viewDate)或纬度(latitude)变化时随 localSiderealTime 一起重算。
  function horizontal(ra: number, dec: number): HorizontalPosition {
    const ha = (localSiderealTime.value - ra) * 15 * Math.PI / 180
    const decRad = dec * Math.PI / 180
    const latRad = latitude.value * Math.PI / 180

    const sinAlt = Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(ha)
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
    const az = Math.atan2(
      -Math.cos(decRad) * Math.sin(ha),
      Math.sin(decRad) * Math.cos(latRad) - Math.cos(decRad) * Math.sin(latRad) * Math.cos(ha)
    )
    return { alt, az, visible: alt >= HORIZON_ALT }
  }

  // 每颗星的当前地平位置（与 STARS 下标对应）。
  const starPositions = computed(() => STARS.map(s => horizontal(s.ra, s.dec)))

  // 可见星座：至少有一颗成员星位于地平线以上。
  const visibleConstellations = computed(() =>
    CONSTELLATIONS.map(c => {
      const visibleCount = c.stars.filter(i => starPositions.value[i].visible).length
      return { constellation: c, visibleCount, total: c.stars.length }
    }).filter(item => item.visibleCount > 0)
  )

  // 当前选中天体的地平位置，落坡时详情面板据此标注“不可见”。
  const selectedStarPosition = computed(() =>
    selectedStar.value ? horizontal(selectedStar.value.ra, selectedStar.value.dec) : null
  )

  function projectStar(ra: number, dec: number, cx: number, cy: number, scale: number): [number, number] {
    const { alt, az, visible } = horizontal(ra, dec)
    if (!visible) return [-999, -999] // 地平线以下，不参与绘制/拾取

    const r = (Math.PI / 2 - alt) * scale * 0.45
    const x = cx + panX.value + r * Math.sin(az)
    const y = cy + panY.value - r * Math.cos(az)
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

  // 重新进入页面时恢复同一套时刻/纬度/设置/选中项，给出完全一致的结果。
  watch(
    [viewDate, latitude, zoom, panX, panY, showLabels, showConstLines, showGrid, selectedStar],
    () => {
      const state: PersistedState = {
        viewDate: viewDate.value.toISOString(),
        latitude: latitude.value,
        zoom: zoom.value,
        panX: panX.value,
        panY: panY.value,
        showLabels: showLabels.value,
        showConstLines: showConstLines.value,
        showGrid: showGrid.value,
        selectedStar: selectedStar.value?.name ?? null
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        // 存储不可用时静默降级为会话内状态
      }
    }
  )

  return {
    viewDate, zoom, panX, panY, showLabels, showConstLines, showGrid,
    selectedStar, searchQuery, latitude, longitude,
    localSiderealTime, filteredStars, starPositions,
    visibleConstellations, selectedStarPosition,
    projectStar, starRadius, spectralColor, selectStar,
    STARS, CONSTELLATIONS
  }
})
