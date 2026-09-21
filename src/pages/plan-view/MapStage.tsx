import { View, Text, Input, ScrollView } from '@tarojs/components'
import { memo, type MutableRefObject } from 'react'
import { MapPin } from 'lucide-react-taro/icons/map-pin'
import { Star } from 'lucide-react-taro/icons/star'
import { PlanMap } from '../../components/sheet-map'
import type { PlaceInfo, CollectedPlace } from '../../types'
import { formatDistance } from '../../utils/datetime'
import { isSamePlace } from './place-info'
import type { MapUiMode, PreviewKind, SheetPos } from './types'

export type MapStageProps = {
  mapId: string
  gesturingRef: MutableRefObject<boolean>
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
  onSelectPlace: (item: PlaceInfo, source?: 'map' | 'list') => void
  points: CollectedPlace[]
  inSearchUi: boolean
  deferredUncollectIds: Set<string>
  selectedPlace: PlaceInfo | null
  mapPickedPlace: PlaceInfo | null
  focusPointOnMap: (point: CollectedPlace) => void
  onToggleCollectedListStar: (point: CollectedPlace) => void
  isPlacePicked: (place: PlaceInfo) => boolean
  onToggleTripPick: (place: PlaceInfo) => void
}

function highlightParts(text: string, keyword: string) {
  const source = text || ''
  const q = keyword.trim()
  if (!q || !source) return [{ text: source, hit: false }]
  const hay = source.toLowerCase()
  const needle = q.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  let index = hay.indexOf(needle)
  while (index >= 0) {
    if (index > cursor) parts.push({ text: source.slice(cursor, index), hit: false })
    parts.push({ text: source.slice(index, index + q.length), hit: true })
    cursor = index + q.length
    index = hay.indexOf(needle, cursor)
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), hit: false })
  return parts.length > 0 ? parts : [{ text: source, hit: false }]
}

function HighlightText({
  text,
  keyword,
  className,
}: {
  text: string
  keyword: string
  className: string
}) {
  const parts = highlightParts(text, keyword)
  return (
    <Text className={className}>
      {parts.map((part, index) =>
        part.hit ? (
          <Text key={index} className='sheet-point__hit'>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  )
}

type SheetSearchExpandedBarProps = {
  keyword: string
  inputFocus: boolean
  sheetIsTop: boolean
  onKeywordInput: (value: string) => void
  onSearchFocus: () => void
  onSearchBlur: () => void
  goToTop: () => void
  goToBottom: () => void
  onSheetTouchStart: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchMove: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchEnd: (e: {
    changedTouches?: Array<{ clientY: number }>
    touches?: Array<{ clientY: number }>
  }) => void
}

/**
 * 与结果列表 / 地图中心隔离：搜索结果更新时不重绘 Input，
 * 避免微信受控输入在拼音组字时被掐断。
 */
const SheetSearchExpandedBar = memo(
  function SheetSearchExpandedBar({
    keyword,
    inputFocus,
    sheetIsTop,
    onKeywordInput,
    onSearchFocus,
    onSearchBlur,
    goToTop,
    goToBottom,
    onSheetTouchStart,
    onSheetTouchMove,
    onSheetTouchEnd,
  }: SheetSearchExpandedBarProps) {
    return (
      <View
        className='sheet__search-bar'
        onTouchStart={onSheetTouchStart as never}
        onTouchMove={onSheetTouchMove as never}
        onTouchEnd={onSheetTouchEnd as never}
        onTouchCancel={onSheetTouchEnd as never}
      >
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
            focus={inputFocus && sheetIsTop}
            placeholder='搜索地点'
            confirmType='search'
            onInput={(e) => onKeywordInput(e.detail.value)}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
          />
        </View>
        <View
          className='sheet__cancel'
          onClick={(e) => {
            e.stopPropagation()
            goToBottom()
          }}
        >
          关闭
        </View>
      </View>
    )
  },
  (prev, next) =>
    prev.keyword === next.keyword &&
    prev.inputFocus === next.inputFocus &&
    prev.sheetIsTop === next.sheetIsTop,
)

export function MapStage(props: MapStageProps) {
  const {
    mapId,
    gesturingRef,
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
    mapPickedPlace,
    focusPointOnMap,
    onToggleCollectedListStar,
    isPlacePicked,
    onToggleTripPick,
  } = props
  const mapPickedActive =
    !!mapPickedPlace &&
    !!selectedPlace &&
    isSamePlace(mapPickedPlace, selectedPlace)
  const mapPickedInCollected =
    !!mapPickedPlace &&
    points.some((point) => isSamePlace(point.place, mapPickedPlace))
  const mapPickedInResults =
    !!mapPickedPlace &&
    showSearchResults &&
    results.some((item) => isSamePlace(item, mapPickedPlace))
  const showMapPickedCard =
    !!mapPickedPlace && !mapPickedInCollected && !mapPickedInResults
  const renderPickCheck = (place: PlaceInfo) => {
    const on = isPlacePicked(place)
    return (
      <View
        className={`sheet-point__check${on ? ' sheet-point__check--on' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleTripPick(place)
        }}
      />
    )
  }
  return (
<View className='map-stage'>
  <PlanMap
    mapId={mapId}
    gesturingRef={gesturingRef}
    latitude={mapCenter.latitude}
    longitude={mapCenter.longitude}
    scale={mapScale}
    markers={markers as Array<Record<string, unknown>>}
    className='map-stage__map'
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
      <SheetSearchExpandedBar
        keyword={keyword}
        inputFocus={inputFocus}
        sheetIsTop={sheetPos === 'top'}
        onKeywordInput={onKeywordInput}
        onSearchFocus={onSearchFocus}
        onSearchBlur={onSearchBlur}
        goToTop={goToTop}
        goToBottom={goToBottom}
        onSheetTouchStart={onSheetTouchStart}
        onSheetTouchMove={onSheetTouchMove}
        onSheetTouchEnd={onSheetTouchEnd}
      />
    )}

    {showSheetBody && (
      <ScrollView
        scrollY
        className={`sheet__body${
          sheetPos !== 'bottom' ? ' sheet__body--trip-pick' : ''
        }`}
        enhanced
        showScrollbar
        scrollWithAnimation
        scrollIntoView={scrollIntoView}
      >
        <View className='sheet__body-inner'>
        <View id='sheet-scroll-top' />
        {showMapPickedCard && mapPickedPlace && (
          <>
            <View className='sheet__section-title'>选中地点</View>
            <View
              className={`sheet-point ${mapPickedActive ? 'sheet-point--active' : ''}`}
              onClick={() => onSelectPlace(mapPickedPlace, 'map')}
            >
              <View className='sheet-point__row'>
                <View className='sheet-point__index sheet-point__index--pin'>
                  <MapPin size={16} color={mapPickedActive ? '#ffffff' : '#1a5f4a'} />
                </View>
                <View className='sheet-point__body'>
                  <View className='sheet-point__name'>{mapPickedPlace.name}</View>
                  {!!mapPickedPlace.address && (
                    <View className='sheet-point__addr'>{mapPickedPlace.address}</View>
                  )}
                  {!!formatDistance(mapPickedPlace.distanceMeters) && (
                    <View className='sheet-point__time'>
                      {formatDistance(mapPickedPlace.distanceMeters)}
                    </View>
                  )}
                </View>
                <View
                  className='sheet-point__actions'
                  onClick={(e) => e.stopPropagation()}
                >
                  <View
                    className='collect-star'
                    onClick={() => onCollectSearchPlace(mapPickedPlace)}
                  >
                    <Star size={18} color='#eab308' filled={false} />
                  </View>
                </View>
              </View>
            </View>
          </>
        )}
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
                !!selectedPlace &&
                isSamePlace(item, selectedPlace) &&
                (previewKind === 'search' ||
                  (!!mapPickedPlace && isSamePlace(mapPickedPlace, item)))
              const distance = formatDistance(item.distanceMeters)
              return (
              <View
                id={`search-result-${index}`}
                key={`${item.poiId || item.name}-${item.longitude}-${item.latitude}`}
                className={`sheet-point ${selected ? 'sheet-point--active' : ''}`}
                onClick={() => onSelectPlace(item)}
              >
                <View className='sheet-point__row'>
                  <Text className='sheet-point__index'>{index + 1}</Text>
                  <View className='sheet-point__body'>
                    <HighlightText
                      className='sheet-point__name'
                      text={item.name}
                      keyword={keyword}
                    />
                    <HighlightText
                      className='sheet-point__addr'
                      text={item.address}
                      keyword={keyword}
                    />
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
              : '暂无收藏地点，可在地图上选点收藏'}
          </View>
        ) : (
          points.map((point) => {
            const collected = !deferredUncollectIds.has(point.id)
            const active =
              mapUi === 'preview' &&
              !!selectedPlace &&
              isSamePlace(point.place, selectedPlace) &&
              (previewKind === 'collected' ||
                (!!mapPickedPlace && isSamePlace(mapPickedPlace, point.place)))
            const picked = isPlacePicked(point.place)
            return (
            <View
              id={`collected-${point.id}`}
              key={point.id}
              className={`sheet-point ${active ? 'sheet-point--active' : ''}${
                picked ? ' sheet-point--picked' : ''
              }`}
              onClick={() => {
                onToggleTripPick(point.place)
                if (!active) focusPointOnMap(point)
              }}
            >
              <View className='sheet-point__row'>
                {renderPickCheck(point.place)}
                <View className='sheet-point__body'>
                  <View className='sheet-point__name'>
                    {point.place.name}
                  </View>
                  <View className='sheet-point__addr'>
                    {point.place.address}
                  </View>
                </View>
                <View
                  className='sheet-point__actions'
                  onClick={(e) => e.stopPropagation()}
                >
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
