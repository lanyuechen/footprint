import { View, Text, Input, ScrollView } from '@tarojs/components'
import { memo } from 'react'
import { Star } from 'lucide-react-taro/icons/star'
import type { CollectedPlace, PlaceInfo } from '../../../types'
import { formatDistance } from '../../../utils/datetime'
import { isSamePlace } from '../place-info'

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
    if (index > cursor) {
      parts.push({ text: source.slice(cursor, index), hit: false })
    }
    parts.push({ text: source.slice(index, index + q.length), hit: true })
    cursor = index + q.length
    index = hay.indexOf(needle, cursor)
  }
  if (cursor < source.length) {
    parts.push({ text: source.slice(cursor), hit: false })
  }
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

export type TripAddSearchBarProps = {
  keyword: string
  onKeywordChange: (value: string) => void
  onFocus?: () => void
}

/** 添加模式：抓手（sheet grab 区） */
export function TripAddGrab() {
  return (
    <View className='sheet__handle'>
      <View className='sheet__handle-bar' />
    </View>
  )
}

/** 添加模式：搜索框（同属 grab；输入框吞掉触摸以免与拖 panel 冲突） */
export const TripAddSearchBar = memo(function TripAddSearchBar({
  keyword,
  onKeywordChange,
  onFocus,
}: TripAddSearchBarProps) {
  return (
    <View className='sheet__search-bar trip-add__search-bar'>
      <View
        className='sheet__input-wrap'
        // 拦截触摸，避免冒泡到 grab 开始拖 panel；Input 仍可聚焦输入
        catchTouchStart={() => {}}
      >
        <Input
          className='sheet__input'
          value={keyword}
          focus
          placeholder='搜索地点'
          confirmType='search'
          onInput={(e) => onKeywordChange(e.detail.value)}
          onFocus={() => onFocus?.()}
        />
      </View>
    </View>
  )
})

/** 添加模式：grab 顶栏（把手 + 搜索，整区可拖 panel） */
export function TripAddHeader({
  keyword,
  onKeywordChange,
  onFocus,
}: TripAddSearchBarProps) {
  return (
    <>
      <TripAddGrab />
      <TripAddSearchBar
        keyword={keyword}
        onKeywordChange={onKeywordChange}
        onFocus={onFocus}
      />
    </>
  )
}

export type TripAddListProps = {
  keyword: string
  searching: boolean
  hasSearched: boolean
  results: PlaceInfo[]
  /** 已收藏列表（含会话草稿） */
  places: CollectedPlace[]
  selectedPlace: PlaceInfo | null
  mapPickedPlace: PlaceInfo | null
  isPlacePicked: (place: PlaceInfo) => boolean
  isFavorited: (place: PlaceInfo) => boolean
  onSelectPlace: (place: PlaceInfo, source?: 'map' | 'list') => void
  onTogglePick: (place: PlaceInfo) => void
  onToggleCollected: (point: CollectedPlace) => void
  onToggleFavorite: (place: PlaceInfo) => void
}

/** 添加模式：地图选点 / 搜索结果 / 已收藏列表 */
export function TripAddList({
  keyword,
  searching,
  hasSearched,
  results,
  places,
  selectedPlace,
  mapPickedPlace,
  isPlacePicked,
  isFavorited,
  onSelectPlace,
  onTogglePick,
  onToggleCollected,
  onToggleFavorite,
}: TripAddListProps) {
  const showSearchResults = results.length > 0 || searching || hasSearched
  const mapPickedActive =
    !!mapPickedPlace &&
    !!selectedPlace &&
    isSamePlace(mapPickedPlace, selectedPlace)
  const mapPickedInCollected =
    !!mapPickedPlace &&
    places.some((point) => isSamePlace(point.place, mapPickedPlace))
  const mapPickedInResults =
    !!mapPickedPlace &&
    showSearchResults &&
    results.some((item) => isSamePlace(item, mapPickedPlace))
  const showMapPickedCard =
    !!mapPickedPlace && !mapPickedInCollected && !mapPickedInResults

  const renderFavBtn = (place: PlaceInfo) => {
    const on = isFavorited(place)
    return (
      <View
        className='sheet-point__fav'
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite(place)
        }}
      >
        <Star size={22} color={on ? '#eab308' : '#8a9199'} filled={on} />
      </View>
    )
  }

  const renderIndex = (num: number, picked: boolean) => (
    <Text
      className={`sheet-point__index${
        picked ? ' sheet-point__index--on' : ''
      }`}
    >
      {num}
    </Text>
  )

  return (
    <ScrollView
      scrollY
      className='sheet__body sheet__body--trip-pick'
      enhanced
      showScrollbar
    >
      <View className='sheet__body-inner'>
        {showMapPickedCard && mapPickedPlace && (
          <>
            <View className='sheet__section-title'>选中地点</View>
            <View
              className={`sheet-point ${
                mapPickedActive ? 'sheet-point--active' : ''
              }${isPlacePicked(mapPickedPlace) ? ' sheet-point--picked' : ''}`}
              onClick={() => onTogglePick(mapPickedPlace)}
            >
              <View className='sheet-point__row'>
                {renderIndex(1, isPlacePicked(mapPickedPlace))}
                <View className='sheet-point__body'>
                  <View className='sheet-point__name'>
                    {mapPickedPlace.name}
                  </View>
                  {!!mapPickedPlace.address && (
                    <View className='sheet-point__addr'>
                      {mapPickedPlace.address}
                    </View>
                  )}
                  {!!formatDistance(mapPickedPlace.distanceMeters) && (
                    <View className='sheet-point__time'>
                      {formatDistance(mapPickedPlace.distanceMeters)}
                    </View>
                  )}
                </View>
                <View className='sheet-point__actions'>
                  {renderFavBtn(mapPickedPlace)}
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
              const selected =
                !!selectedPlace && isSamePlace(item, selectedPlace)
              const distance = formatDistance(item.distanceMeters)
              return (
                <View
                  key={`${item.poiId || item.name}-${item.longitude}-${item.latitude}`}
                  className={`sheet-point ${
                    selected ? 'sheet-point--active' : ''
                  }${isPlacePicked(item) ? ' sheet-point--picked' : ''}`}
                  onClick={() => onSelectPlace(item)}
                >
                  <View className='sheet-point__row'>
                    {renderIndex(index + 1, isPlacePicked(item))}
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
                    <View className='sheet-point__actions'>
                      {renderFavBtn(item)}
                    </View>
                  </View>
                </View>
              )
            })}
          </>
        )}

        <View className='sheet__section-title'>已收藏（{places.length}）</View>
        {places.length === 0 ? (
          <View className='sheet__empty'>
            暂无收藏，搜索或点地图选点后可加入行程
          </View>
        ) : (
          places.map((point, index) => {
            const active =
              !!selectedPlace && isSamePlace(point.place, selectedPlace)
            const picked = isPlacePicked(point.place)
            return (
              <View
                key={point.id}
                className={`sheet-point ${
                  active ? 'sheet-point--active' : ''
                }${picked ? ' sheet-point--picked' : ''}`}
                onClick={() => onToggleCollected(point)}
              >
                <View className='sheet-point__row'>
                  {renderIndex(index + 1, picked)}
                  <View className='sheet-point__body'>
                    <View className='sheet-point__name'>
                      {point.place.name}
                    </View>
                    <View className='sheet-point__addr'>
                      {point.place.address}
                    </View>
                  </View>
                  <View className='sheet-point__actions'>
                    {renderFavBtn(point.place)}
                  </View>
                </View>
              </View>
            )
          })
        )}
      </View>
    </ScrollView>
  )
}

export type TripConfirmBarProps = {
  count: number
  onCancel: () => void
  onConfirm: () => void
}

export function TripConfirmBar({
  count,
  onCancel,
  onConfirm,
}: TripConfirmBarProps) {
  return (
    <View className='trip-confirm-bar'>
      <View className='trip-confirm-bar__btn' onClick={onCancel}>
        取消
      </View>
      <View
        className='trip-confirm-bar__btn trip-confirm-bar__btn--primary'
        onClick={onConfirm}
      >
        确定{count > 0 ? `（${count}）` : ''}
      </View>
    </View>
  )
}
