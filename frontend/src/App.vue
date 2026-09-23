<template>
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-72 bg-gray-900 p-4 flex flex-col gap-4 overflow-y-auto">
      <h1 class="text-xl font-bold text-blue-400">天文星图渲染器</h1>

      <!-- Search -->
      <div>
        <input v-model="store.searchQuery" placeholder="搜索天体..." class="w-full bg-gray-800 rounded px-3 py-2 text-sm" />
        <div v-if="store.filteredStars.length" class="mt-1">
          <div v-for="s in store.filteredStars" :key="s.name"
            @click="store.selectedStar = s"
            class="bg-gray-800 p-2 rounded mt-1 cursor-pointer hover:bg-gray-700 text-sm">
            {{ s.name }} <span class="text-gray-400">mag {{ s.mag }}</span>
          </div>
        </div>
      </div>

      <!-- Time Travel -->
      <div>
        <label class="text-gray-400 text-xs">时间旅行（本地时间 {{ timeZoneName }}）</label>
        <input type="datetime-local" v-model="dateStr"
          class="w-full bg-gray-800 rounded px-3 py-2 text-sm" />
      </div>

      <!-- Location -->
      <div>
        <label class="text-gray-400 text-xs">纬度: {{ store.latitude.toFixed(1) }}°</label>
        <input type="range" v-model.number="store.latitude" min="-90" max="90" step="0.1" class="w-full" />
      </div>

      <!-- Zoom -->
      <div>
        <label class="text-gray-400 text-xs">缩放: {{ store.zoom.toFixed(1) }}x</label>
        <input type="range" v-model.number="store.zoom" min="0.3" max="3" step="0.1" class="w-full" />
      </div>

      <!-- Toggles -->
      <div class="flex flex-col gap-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="store.showLabels" /> 星名标签
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="store.showConstLines" /> 星座连线
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="store.showGrid" /> 坐标网格
        </label>
      </div>

      <!-- Star Info -->
      <div v-if="store.selectedStar" class="bg-gray-800 rounded-xl p-3">
        <h3 class="text-amber-400 font-bold">{{ store.selectedStar.name }}</h3>
        <p v-if="store.selectedStarPosition"
          class="mt-1 text-xs font-semibold"
          :class="store.selectedStarPosition.visible ? 'text-green-400' : 'text-red-400'">
          {{ store.selectedStarPosition.visible
            ? '可见 · 位于地平线上'
            : `不可见 · 位于地平线下 ${Math.abs(altDeg).toFixed(1)}°` }}
        </p>
        <div class="text-xs text-gray-300 mt-2 space-y-1">
          <p>赤经: {{ store.selectedStar.ra.toFixed(2) }}h</p>
          <p>赤纬: {{ store.selectedStar.dec.toFixed(2) }}°</p>
          <p>高度角: {{ altDeg.toFixed(1) }}°</p>
          <p>方位角: {{ azDeg.toFixed(1) }}°</p>
          <p>视星等: {{ store.selectedStar.mag }}</p>
          <p>光谱型: {{ store.selectedStar.spectral }}</p>
        </div>
      </div>

      <!-- Constellation list -->
      <div class="text-xs">
        <h4 class="text-gray-400 mb-1">可见星座（{{ store.visibleConstellations.length }}/{{ store.CONSTELLATIONS.length }}）</h4>
        <p v-if="!store.visibleConstellations.length" class="py-1 text-gray-500">当前时刻与纬度没有可见星座</p>
        <div v-for="item in store.visibleConstellations" :key="item.constellation.name"
          class="py-1 text-gray-300">
          {{ item.constellation.nameCn }} <span class="text-gray-500">({{ item.constellation.name }})</span>
          <span class="text-gray-600">{{ item.visibleCount }}/{{ item.total }}</span>
        </div>
      </div>

      <div class="text-xs text-gray-500 mt-auto">
        <p>观测点: {{ Math.abs(store.latitude).toFixed(1) }}°{{ store.latitude >= 0 ? 'N' : 'S' }}, {{ store.longitude.toFixed(1) }}°E</p>
        <p>本地恒星时 LST: {{ store.localSiderealTime.toFixed(2) }}h</p>
      </div>
    </div>

    <!-- Sky Canvas -->
    <div class="flex-1 relative">
      <StarCanvas />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSkyStore, formatLocalDatetime, parseLocalDatetime } from './store/sky'
import StarCanvas from './components/StarCanvas.vue'

const store = useSkyStore()

// datetime-local 没有时区概念，一律按用户本地时区读写，
// 与 store.viewDate（绝对时刻）双向一致，不再经 toISOString 转成 UTC。
const dateStr = computed({
  get: () => formatLocalDatetime(store.viewDate),
  set: (v: string) => {
    const d = parseLocalDatetime(v)
    if (d) store.viewDate = d
  }
})

const timeZoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
  .formatToParts(store.viewDate).find(p => p.type === 'timeZoneName')?.value ?? '本地时区'

const altDeg = computed(() => (store.selectedStarPosition?.alt ?? 0) * 180 / Math.PI)
const azDeg = computed(() => ((store.selectedStarPosition?.az ?? 0) * 180 / Math.PI + 360) % 360)
</script>
