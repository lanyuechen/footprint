import { View, Text, Input, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Star } from 'lucide-react-taro/icons/star'
import type { PlaceInfo, TargetPoint } from '../../types'
import { formatDateTime, formatDistance } from '../../utils/datetime'
import { isSamePlace } from './place-info'
import { PlanMap } from './PlanMap'
import type { MapUiMode, PreviewKind, SheetPos } from './types'

export type MapStageProps = {
  mapCenter: { latitude: number; longitude: number }
  mapScale: number
  markers: Array<Record<string, unknown>>
  onRegionChange: (e: {
    type?: string
    causedBy?: string
    detail?: Record<string, unknown>
  }) => void
  onMarkerTap: (e: { detail: { markerId: number | string } }) => void
  onPoiTap: (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => void
  onMapClick: () => void
  sheetClass: string
  dragHeightPx: number | null
  onSheetTouchStart: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchMove: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchEnd: (e: { changedTouches: Array<{ clientY: number }> }) => void
  sheetPos: SheetPos
  goToBottom: () => void
  goToTop: () => void
  keyword: string
  inputFocus: boolean
  onKeywordInput: (value: string) => void
  onSearchFocus: () => void
  onSearchBlur: () => void
  onCollectSearchPlace: (place: PlaceInfo) => void
  showSheetBody: boolean
  scrollIntoView: string
  mapUi: MapUiMode
  previewKind: PreviewKind
  showSearchResults: boolean
  searching: boolean
  hasSearched: boolean
  results: PlaceInfo[]
  onSelectPlace: (item: PlaceInfo) => void
  points: TargetPoint[]
  inSearchUi: boolean
  deferredUncollectIds: Set<string>
  selectedPlace: PlaceInfo | null
  focusPointOnMap: (point: TargetPoint) => void
  onToggleCollectedListStar: (point: TargetPoint) => void
}

export function MapStage(props: MapStageProps) {
  const {
    mapCenter,
    mapScale,
    markers,
    onRegionChange: stableOnRegionChange,
    onMarkerTap: stableOnMarkerTap,
    onPoiTap: stableOnPoiTap,
    onMapClick: stableOnMapClick,
    sheetClass,
    dragHeightPx,
    onSheetTouchStart,
    onSheetTouchMove,
    onSheetTouchEnd,
    sheetPos,
    goToBottom,
    goToTop,
    keyword,
    inputFocus,
    onKeywordInput,
    onSearchFocus,
    onSearchBlur,
    onCollectSearchPlace,
    showSheetBody,
    scrollIntoView,
    mapUi,
    previewKind,
    showSearchResults,
    searching,
    hasSearched,
    results,
    onSelectPlace,
    points,
    inSearchUi,
    deferredUncollectIds,
    selectedPlace,
    focusPointOnMap,
    onToggleCollectedListStar,
  } = props
  return (
<View className='map-stage'>
  <PlanMap
    latitude={mapCenter.latitude}
    longitude={mapCenter.longitude}
    scale={mapScale}
    markers={markers as Array<Record<string, unknown>>}
    onRegionChange={stableOnRegionChange}
    onMarkertap={stableOnMarkerTap}
    onPoiTap={stableOnPoiTap}
    onClick={stableOnMapClick}
  />

  <View
    className={sheetClass}
    style={dragHeightPx != null ? { height: `${dragHeightPx}px` } : undefined}
  >
    <View
      className='sheet__grab'
      catchMove
            onTouchStart={onSheetTouchStart as never}
            onTouchMove={onSheetTouchMove as never}
            onTouchEnd={onSheetTouchEnd as never}
            onTouchCancel={onSheetTouchEnd as never}
    >
      <View className='sheet__handle'>
        <View className='sheet__handle-bar' />
      </View>

      {sheetPos === 'bottom' && (
        <View className='sheet__search-wrap'>
          <View
            className='sheet__search'
            onClick={(e) => {
              e.stopPropagation()
              goToTop()
            }}
          >
            <Text
              className={`sheet__input-text ${
                keyword ? '' : 'sheet__input-text--placeholder'
              }`}
            >
              {keyword || '搜索地点'}
            </Text>
          </View>
        </View>
      )}
    </View>

    {(sheetPos === 'top' || sheetPos === 'middle') && (
      <View
        className='sheet__search-bar'
        onTouchStart={onSheetTouchStart as never}
        onTouchMove={onSheetTouchMove as never}
        onTouchEnd={onSheetTouchEnd as never}
        onTouchCancel={onSheetTouchEnd as never}
      >
        <View
          className='sheet__cancel'
          onClick={(e) => {
            e.stopPropagation()
            goToBottom()
          }}
        >
          关闭
        </View>
        <View
          className='sheet__input-wrap'
          onClick={(e) => {
            e.stopPropagation()
            goToTop()
          }}
        >
          <Input
            className='sheet__input'
            value={keyword}
            focus={inputFocus && sheetPos === 'top'}
            placeholder='搜索地点'
            confirmType='search'
            onInput={(e) => onKeywordInput(e.detail.value)}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
          />
        </View>
      </View>
    )}

    {showSheetBody && (
      <ScrollView
        scrollY
        className='sheet__body'
        enhanced
        showScrollbar
        scrollWithAnimation
        scrollIntoView={scrollIntoView}
      >
        <View className='sheet__body-inner'>
        <View id='sheet-scroll-top' />
        {showSearchResults && (
          <>
            <View className='sheet__section-title'>
              {searching ? '搜索中…' : `搜索结果（${results.length}）`}
            </View>
            {!searching && hasSearched && results.length === 0 && (
              <View className='sheet__empty'>未找到相关地点</View>
            )}
            {results.map((item, index) => {
              const collected = points.some(
                (point) =>
                  isSamePlace(point.place, item) && !deferredUncollectIds.has(point.id),
              )
              const selected =
                previewKind === 'search' &&
                !!selectedPlace &&
                isSamePlace(item, selectedPlace)
              const distance = formatDistance(item.distanceMeters)
              return (
              <View
                key={`${item.poiId || item.name}-${item.longitude}-${item.latitude}`}
                className={`sheet-point ${selected ? 'sheet-point--active' : ''}`}
                onClick={() => onSelectPlace(item)}
              >
                <Text className='sheet-point__index'>{index + 1}</Text>
                <View className='sheet-point__body'>
                  <View className='sheet-point__name'>{item.name}</View>
                  <View className='sheet-point__addr'>{item.address}</View>
                  {!!distance && (
                    <View className='sheet-point__time'>{distance}</View>
                  )}
                </View>
                <View
                  className='sheet-point__actions'
                  onClick={(e) => e.stopPropagation()}
                >
                  <View
                    className='collect-star'
                    onClick={() => onCollectSearchPlace(item)}
                  >
                    <Star size={18} color='#eab308' filled={collected} />
                  </View>
                </View>
              </View>
              )
            })}
          </>
        )}

        <View className='sheet__section-title'>
          已收藏（{points.length}）
        </View>
        {points.length === 0 ? (
          <View className='sheet__empty'>
            {inSearchUi
              ? '暂无收藏，搜索地点后可加入'
              : '暂无目标点，可收藏当前地点'}
          </View>
        ) : (
          points.map((point, index) => {
            const collected = !deferredUncollectIds.has(point.id)
            const active =
              mapUi === 'preview' &&
              previewKind === 'collected' &&
              !!selectedPlace &&
              isSamePlace(point.place, selectedPlace)
            return (
            <View
              id={`collected-${point.id}`}
              key={point.id}
              className={`sheet-point ${
                active ? 'sheet-point--active' : ''
              }`}
              onClick={() => focusPointOnMap(point)}
            >
              <Text className='sheet-point__index'>{index + 1}</Text>
              <View className='sheet-point__body'>
                <View className='sheet-point__name'>
                  {point.place.name}
                </View>
                <View className='sheet-point__addr'>
                  {point.place.address}
                </View>
                <View className='sheet-point__time'>
                  {formatDateTime(point.expectedAt)}
                </View>
                {!!point.noteText && (
                  <View className='sheet-point__note'>{point.noteText}</View>
                )}
              </View>
              <View
                className='sheet-point__actions'
                onClick={(e) => e.stopPropagation()}
              >
                <View
                  className='nav-entry'
                  onClick={() => {
                    Taro.navigateTo({
                      url: `/pages/nav/index?pointId=${point.id}`,
                    })
                  }}
                >
                  <Navigation size={16} color='#1a5f4a' />
                </View>
                <View
                  className='edit-entry'
                  onClick={() => {
                    Taro.navigateTo({
                      url: `/pages/point-note/index?pointId=${point.id}`,
                    })
                  }}
                >
                  <SquarePen size={16} color='#1a5f4a' />
                </View>
                <View
                  className='collect-star'
                  onClick={() => onToggleCollectedListStar(point)}
                >
                  <Star
                    size={18}
                    color='#eab308'
                    filled={collected}
                  />
                </View>
              </View>
            </View>
            )
          })
        )}
        </View>
      </ScrollView>
    )}
  </View>
</View>
  )
}
