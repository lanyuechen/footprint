import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { ListFilter } from 'lucide-react-taro/icons/list-filter'
import { MapPin } from 'lucide-react-taro/icons/map-pin'
import { MessageSquareMore } from 'lucide-react-taro/icons/message-square-more'
import { Waypoints } from 'lucide-react-taro/icons/waypoints'
import { lightenColor, type PlaceTypeOption } from './place-axis'
import { placeTypeFilterKey } from './place-type-filter'
import { useDropdownAnim } from '../../hooks/useDropdownAnim'
import {
  setPlanMapFilterPref,
  setPlanTypeFilterKeys,
} from '../../services/storage'

const ICON_OFF_BG = '#f0f1f2'
const ICON_OFF_COLOR = '#c8cdd3'
const MAP_PIN_COLOR = '#1a5f4a'
const MAP_ROUTE_COLOR = '#0ea5e9'
const MAP_TIPS_COLOR = '#f97316'

type TypeFilterProps = {
  planId: string
  options: PlaceTypeOption[]
  selectedKeys: string[]
  /** 是否显示路径（点始终开启） */
  showRoutes: boolean
  /** 是否显示路径距离气泡 */
  showRouteTips: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  onChange: (keys: string[]) => void
  onShowRoutesChange: (showRoutes: boolean) => void
  onShowRouteTipsChange: (showRouteTips: boolean) => void
}

export function TypeFilter({
  planId,
  options,
  selectedKeys,
  showRoutes,
  showRouteTips,
  open,
  onToggle,
  onClose,
  onChange,
  onShowRoutesChange,
  onShowRouteTipsChange,
}: TypeFilterProps) {
  const allKeys = useMemo(
    () => options.map((opt) => placeTypeFilterKey(opt)),
    [options],
  )
  const allSelected =
    allKeys.length > 0 && allKeys.every((k) => selectedKeys.includes(k))
  /** 未全选类型，或关闭了路径 / 提示 */
  const active =
    (options.length > 0 && !allSelected) || !showRoutes || !showRouteTips
  const { mounted, shown } = useDropdownAnim(open)
  /** 面板内即时高亮；延后同步到列表，避免 Taro 卸节点时 removeEventListener 崩 */
  const [draftKeys, setDraftKeys] = useState(selectedKeys)
  const [draftShowRoutes, setDraftShowRoutes] = useState(showRoutes)
  const [draftShowRouteTips, setDraftShowRouteTips] = useState(showRouteTips)
  const onToggleRef = useRef(onToggle)
  const onCloseRef = useRef(onClose)
  const onChangeRef = useRef(onChange)
  const onShowRoutesChangeRef = useRef(onShowRoutesChange)
  const onShowRouteTipsChangeRef = useRef(onShowRouteTipsChange)
  const planIdRef = useRef(planId)
  onToggleRef.current = onToggle
  onCloseRef.current = onClose
  onChangeRef.current = onChange
  onShowRoutesChangeRef.current = onShowRoutesChange
  onShowRouteTipsChangeRef.current = onShowRouteTipsChange
  planIdRef.current = planId

  useEffect(() => {
    if (open) {
      setDraftKeys(selectedKeys)
      setDraftShowRoutes(showRoutes)
      setDraftShowRouteTips(showRouteTips)
    }
  }, [open, selectedKeys, showRoutes, showRouteTips])

  const draftAllSelected =
    allKeys.length > 0 && allKeys.every((k) => draftKeys.includes(k))

  const commitKeys = useCallback(
    (keys: string[]) => {
      const id = planIdRef.current
      if (id) setPlanTypeFilterKeys(id, keys, allKeys)
      setTimeout(() => onChangeRef.current(keys), 0)
    },
    [allKeys],
  )

  const commitShowRoutes = useCallback((next: boolean) => {
    const id = planIdRef.current
    if (id) setPlanMapFilterPref(id, { showRoutes: next })
    setTimeout(() => onShowRoutesChangeRef.current(next), 0)
  }, [])

  const commitShowRouteTips = useCallback((next: boolean) => {
    const id = planIdRef.current
    if (id) setPlanMapFilterPref(id, { showRouteTips: next })
    setTimeout(() => onShowRouteTipsChangeRef.current(next), 0)
  }, [])

  const handleToggle = useCallback(() => {
    onToggleRef.current()
  }, [])

  const handleClose = useCallback(() => {
    onCloseRef.current()
  }, [])

  const handleSelectAll = useCallback(() => {
    const keys = options.map((opt) => placeTypeFilterKey(opt))
    setDraftKeys(keys)
    commitKeys(keys)
  }, [options, commitKeys])

  const handleItemClick = useCallback(
    (e: { currentTarget: { dataset: Record<string, string> } }) => {
      const key = e.currentTarget.dataset.key
      if (!key) return
      setDraftKeys((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key]
        commitKeys(next)
        return next
      })
    },
    [commitKeys],
  )

  const handleToggleRoutes = useCallback(() => {
    setDraftShowRoutes((prev) => {
      const next = !prev
      commitShowRoutes(next)
      return next
    })
  }, [commitShowRoutes])

  const handleToggleRouteTips = useCallback(() => {
    setDraftShowRouteTips((prev) => {
      const next = !prev
      commitShowRouteTips(next)
      return next
    })
  }, [commitShowRouteTips])

  return (
    <View className='type-filter-root'>
      <View
        className={`map-fab map-fab--right${
          active ? ' map-fab--active' : ''
        }`}
        onClick={handleToggle}
      >
        <ListFilter size={16} color='#1a5f4a' />
      </View>
      {mounted ? (
        <View className={`type-filter${shown ? ' type-filter--open' : ''}`}>
          <View className='type-filter__mask' onClick={handleClose} />
          <View className='type-filter__panel'>
            <View className='type-filter__section'>
              <View className='type-filter__head'>
                <Text className='type-filter__title'>地图筛选</Text>
                <Text className='type-filter__close' onClick={handleClose}>
                  关闭
                </Text>
              </View>
              <View className='type-filter__grid type-filter__grid--map'>
                <View className='type-filter__item type-filter__item--locked'>
                  <View
                    className='type-filter__icon'
                    style={{ backgroundColor: lightenColor(MAP_PIN_COLOR) }}
                  >
                    <MapPin size={16} color={MAP_PIN_COLOR} />
                  </View>
                  <Text className='type-filter__label'>点</Text>
                </View>
                <View className='type-filter__item' onClick={handleToggleRoutes}>
                  <View
                    className='type-filter__icon'
                    style={{
                      backgroundColor: draftShowRoutes
                        ? lightenColor(MAP_ROUTE_COLOR)
                        : ICON_OFF_BG,
                    }}
                  >
                    <Waypoints
                      size={16}
                      color={draftShowRoutes ? MAP_ROUTE_COLOR : ICON_OFF_COLOR}
                    />
                  </View>
                  <Text className='type-filter__label'>路径</Text>
                </View>
                <View
                  className='type-filter__item'
                  onClick={handleToggleRouteTips}
                >
                  <View
                    className='type-filter__icon'
                    style={{
                      backgroundColor: draftShowRouteTips
                        ? lightenColor(MAP_TIPS_COLOR)
                        : ICON_OFF_BG,
                    }}
                  >
                    <MessageSquareMore
                      size={16}
                      color={
                        draftShowRouteTips ? MAP_TIPS_COLOR : ICON_OFF_COLOR
                      }
                    />
                  </View>
                  <Text className='type-filter__label'>提示</Text>
                </View>
              </View>
            </View>

            <View className='type-filter__divider' />

            <View className='type-filter__section'>
              <View className='type-filter__head'>
                <Text className='type-filter__title'>类型筛选</Text>
                <View className='type-filter__head-actions'>
                  <Text
                    className={`type-filter__all${
                      draftAllSelected ? ' type-filter__all--on' : ''
                    }`}
                    onClick={handleSelectAll}
                  >
                    全部
                  </Text>
                </View>
              </View>
              {options.length === 0 ? (
                <View className='type-filter__empty'>暂无可筛选类型</View>
              ) : (
                <View className='type-filter__grid'>
                  {options.map((opt) => {
                    const key = placeTypeFilterKey(opt)
                    const on = draftKeys.includes(key)
                    const Icon = opt.mark.icon
                    return (
                      <View
                        key={key}
                        className='type-filter__item'
                        data-key={key}
                        onClick={handleItemClick}
                      >
                        <View
                          className='type-filter__icon'
                          style={{
                            backgroundColor: on
                              ? lightenColor(opt.mark.color)
                              : ICON_OFF_BG,
                          }}
                        >
                          <Icon
                            size={16}
                            color={on ? opt.mark.color : ICON_OFF_COLOR}
                          />
                        </View>
                        <Text className='type-filter__label'>{opt.label}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
