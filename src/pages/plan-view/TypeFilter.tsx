import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { ListFilter } from 'lucide-react-taro/icons/list-filter'
import { lightenColor, type PlaceTypeOption } from './place-axis'
import { placeTypeFilterKey } from './place-type-filter'
import { useDropdownAnim } from './useDropdownAnim'

const ICON_OFF_BG = '#f0f1f2'
const ICON_OFF_COLOR = '#c8cdd3'

type TypeFilterProps = {
  options: PlaceTypeOption[]
  selectedKeys: string[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onChange: (keys: string[]) => void
}

export function TypeFilter({
  options,
  selectedKeys,
  open,
  onToggle,
  onClose,
  onChange,
}: TypeFilterProps) {
  const allKeys = useMemo(
    () => options.map((opt) => placeTypeFilterKey(opt)),
    [options],
  )
  const allSelected =
    allKeys.length > 0 && allKeys.every((k) => selectedKeys.includes(k))
  /** 未全选时表示正在筛选 */
  const active = options.length > 0 && !allSelected
  const { mounted, shown } = useDropdownAnim(open)
  /** 面板内即时高亮；延后同步到列表，避免 Taro 卸节点时 removeEventListener 崩 */
  const [draftKeys, setDraftKeys] = useState(selectedKeys)
  const onToggleRef = useRef(onToggle)
  const onCloseRef = useRef(onClose)
  const onChangeRef = useRef(onChange)
  onToggleRef.current = onToggle
  onCloseRef.current = onClose
  onChangeRef.current = onChange

  useEffect(() => {
    if (open) setDraftKeys(selectedKeys)
  }, [open, selectedKeys])

  const draftAllSelected =
    allKeys.length > 0 && allKeys.every((k) => draftKeys.includes(k))

  const handleToggle = useCallback(() => {
    onToggleRef.current()
  }, [])

  const handleClose = useCallback(() => {
    onCloseRef.current()
  }, [])

  const handleSelectAll = useCallback(() => {
    setDraftKeys(() => {
      const keys = options.map((opt) => placeTypeFilterKey(opt))
      setTimeout(() => onChangeRef.current(keys), 0)
      return keys
    })
  }, [options])

  const handleItemClick = useCallback(
    (e: { currentTarget: { dataset: Record<string, string> } }) => {
      const key = e.currentTarget.dataset.key
      if (!key) return
      setDraftKeys((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key]
        setTimeout(() => onChangeRef.current(next), 0)
        return next
      })
    },
    [],
  )

  return (
    <View className='type-filter-root'>
      <View
        className={`map-fab map-fab--right map-fab--below${
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
                <Text className='type-filter__close' onClick={handleClose}>
                  关闭
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
      ) : null}
    </View>
  )
}
