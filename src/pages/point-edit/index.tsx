import { useLoad } from '@tarojs/taro'
import { View, Text, Input, Picker, Map } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlaceInfo } from '../../types'
import { getUserLocation, searchPlaces } from '../../services/amap'
import type { UserLocation } from '../../services/amap'
import {
  createPoint,
  getPoint,
  getPlan,
  updatePoint,
} from '../../services/storage'
import {
  combineDateTime,
  toDatePart,
  toTimePart,
} from '../../utils/datetime'
import './index.scss'

const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }
const SEARCH_DEBOUNCE_MS = 400

export default function PointEditPage() {
  const [planId, setPlanId] = useState('')
  const [pointId, setPointId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PlaceInfo[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState<PlaceInfo | null>(null)
  const [datePart, setDatePart] = useState(toDatePart(''))
  const [timePart, setTimePart] = useState(toTimePart(''))
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER)
  const [mapScale, setMapScale] = useState(12)
  const searchSeq = useRef(0)
  const skipNextSearch = useRef(false)
  const placeRef = useRef<PlaceInfo | null>(null)
  const blurHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearBlurHideTimer = () => {
    if (blurHideTimer.current) {
      clearTimeout(blurHideTimer.current)
      blurHideTimer.current = null
    }
  }

  const isEdit = !!pointId

  useEffect(() => {
    placeRef.current = place
  }, [place])

  useEffect(() => {
    return () => clearBlurHideTimer()
  }, [])

  useLoad((options) => {
    const pid = options?.planId || ''
    const ptid = options?.pointId || ''
    setPlanId(pid)

    if (!pid || !getPlan(pid)) {
      Taro.showToast({ title: '计划不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }

    if (ptid) {
      const point = getPoint(ptid)
      if (!point) {
        Taro.showToast({ title: '目标点不存在', icon: 'none' })
        setTimeout(() => Taro.navigateBack(), 800)
        return
      }
      setPointId(point.id)
      setPlace(point.place)
      placeRef.current = point.place
      setKeyword(point.place.name)
      setMapCenter({
        latitude: point.place.latitude,
        longitude: point.place.longitude,
      })
      setMapScale(15)
      setDatePart(toDatePart(point.expectedAt))
      setTimePart(toTimePart(point.expectedAt))
      skipNextSearch.current = true
      setShowDropdown(false)
      Taro.setNavigationBarTitle({ title: '编辑目标点' })
    } else {
      Taro.setNavigationBarTitle({ title: '添加目标点' })
    }
  })

  useEffect(() => {
    let cancelled = false
    getUserLocation().then((loc) => {
      if (cancelled || !loc) return
      setUserLocation(loc)
      if (!placeRef.current) {
        setMapCenter(loc)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }

    const q = keyword.trim()
    if (!q) {
      setResults([])
      setShowDropdown(false)
      setSearching(false)
      return
    }

    const seq = ++searchSeq.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const list = await searchPlaces(q, userLocation)
        if (seq !== searchSeq.current) return
        setResults(list)
        setShowDropdown(list.length > 0)
      } catch (err) {
        if (seq !== searchSeq.current) return
        const msg = err instanceof Error ? err.message : '搜索失败'
        Taro.showToast({ title: msg, icon: 'none' })
        setResults([])
        setShowDropdown(false)
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [keyword, userLocation])

  /** 仅在选中地点后标点，搜索过程不在地图上打点 */
  const markers = useMemo(() => {
    if (!place) return []
    return [
      {
        id: 1,
        latitude: place.latitude,
        longitude: place.longitude,
        title: place.name,
        width: 24,
        height: 34,
        callout: {
          content: place.name,
          display: 'ALWAYS' as const,
          padding: 6,
          borderRadius: 4,
          fontSize: 12,
        },
      },
    ]
  }, [place])

  const onSelectPlace = (item: PlaceInfo) => {
    clearBlurHideTimer()
    skipNextSearch.current = true
    setPlace(item)
    placeRef.current = item
    setResults([])
    setShowDropdown(false)
    setKeyword(item.name)
    setMapCenter({ latitude: item.latitude, longitude: item.longitude })
    setMapScale(15)
  }

  const onKeywordInput = (value: string) => {
    setKeyword(value)
    if (place && value !== place.name) {
      setPlace(null)
      setMapScale(12)
    }
  }

  const onSearchFocus = () => {
    clearBlurHideTimer()
    if (results.length > 0) setShowDropdown(true)
  }

  const onSearchBlur = () => {
    // 延迟隐藏，避免点击下拉项时先失焦导致选不中
    clearBlurHideTimer()
    blurHideTimer.current = setTimeout(() => {
      setShowDropdown(false)
      blurHideTimer.current = null
    }, 200)
  }

  const onSave = () => {
    if (!place) {
      Taro.showToast({ title: '请先搜索并选择地点', icon: 'none' })
      return
    }
    const expectedAt = combineDateTime(datePart, timePart)
    try {
      if (isEdit) {
        updatePoint(pointId, { place, expectedAt })
        Taro.showToast({ title: '已保存', icon: 'success' })
      } else {
        createPoint({ planId, place, expectedAt })
        Taro.showToast({ title: '已添加', icon: 'success' })
      }
      setTimeout(() => Taro.navigateBack(), 500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  return (
    <View className='point-edit'>
      <View className='section'>
        <Text className='section__title'>搜索地点</Text>
        <View className='search-wrap'>
          <View className='search-box'>
            <Input
              className='search-box__input'
              value={keyword}
              placeholder='输入地点，自动搜索附近优先'
              confirmType='search'
              onInput={(e) => onKeywordInput(e.detail.value)}
              onFocus={onSearchFocus}
              onBlur={onSearchBlur}
            />
            {searching && <Text className='search-box__status'>搜索中</Text>}
          </View>

          {showDropdown && results.length > 0 && (
            <View className='dropdown'>
              {results.map((item) => (
                <View
                  key={`${item.poiId || item.name}-${item.longitude}-${item.latitude}`}
                  className='dropdown__item'
                  onTouchStart={() => onSelectPlace(item)}
                  onClick={() => onSelectPlace(item)}
                >
                  <Text className='dropdown__name'>{item.name}</Text>
                  <Text className='dropdown__addr'>{item.address}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className='map-panel'>
          <Map
            className='map-panel__map'
            latitude={mapCenter.latitude}
            longitude={mapCenter.longitude}
            scale={mapScale}
            markers={markers}
            showLocation
          />
        </View>

        {place && (
          <View className='selected'>
            <Text className='selected__name'>{place.name}</Text>
            <Text className='selected__addr'>{place.address}</Text>
          </View>
        )}
      </View>

      <View className='section'>
        <Text className='section__title'>预期前往时间</Text>
        <View className='picker-row'>
          <Picker
            mode='date'
            value={datePart}
            onChange={(e) => setDatePart(e.detail.value)}
          >
            <View className='picker-row__item'>
              <Text className='picker-row__hint'>日期</Text>
              <Text>{datePart}</Text>
            </View>
          </Picker>
          <Picker
            mode='time'
            value={timePart}
            onChange={(e) => setTimePart(e.detail.value)}
          >
            <View className='picker-row__item'>
              <Text className='picker-row__hint'>时间</Text>
              <Text>{timePart}</Text>
            </View>
          </Picker>
        </View>
      </View>

      <View className='footer'>
        <View className='btn btn--ghost' onClick={() => Taro.navigateBack()}>
          取消
        </View>
        <View className='btn btn--primary' onClick={onSave}>
          保存
        </View>
      </View>
    </View>
  )
}
