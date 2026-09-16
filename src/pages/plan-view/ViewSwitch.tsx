import { Fragment } from 'react'
import { View, Text } from '@tarojs/components'
import { ListTree } from 'lucide-react-taro/icons/list-tree'
import { MapPinned } from 'lucide-react-taro/icons/map-pinned'
import { Plus } from 'lucide-react-taro/icons/plus'
import type { PlanView } from './types'

const PLAN_VIEWS: Array<{ id: PlanView; label: string }> = [
  { id: 'map', label: '地图' },
  { id: 'timeline', label: '时间轴' },
]

type ViewSwitchProps = {
  planView: PlanView
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (view: PlanView) => void
  onAddPlace?: () => void
}

export function ViewSwitch({
  planView,
  open,
  onToggle,
  onClose,
  onSelect,
  onAddPlace,
}: ViewSwitchProps) {
  return (
    <Fragment>
      <View className='map-fab map-fab--right' onClick={onToggle}>
        {planView === 'map' ? (
          <MapPinned size={16} color='#1a5f4a' />
        ) : (
          <ListTree size={16} color='#1a5f4a' />
        )}
      </View>
      {planView === 'timeline' && onAddPlace && (
        <View
          className='map-fab map-fab--right map-fab--below'
          onClick={() => {
            onClose()
            onAddPlace()
          }}
        >
          <Plus size={16} color='#1a5f4a' />
        </View>
      )}
      {open && (
        <View className='view-menu'>
          <View className='view-menu__mask' onClick={onClose} />
          <View className='view-menu__panel'>
            {PLAN_VIEWS.map((item) => {
              const active = item.id === planView
              return (
                <View
                  key={item.id}
                  className={`view-menu__item${active ? ' view-menu__item--active' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  {item.id === 'map' ? (
                    <MapPinned size={16} color={active ? '#1a5f4a' : '#646a73'} />
                  ) : (
                    <ListTree size={16} color={active ? '#1a5f4a' : '#646a73'} />
                  )}
                  <Text className='view-menu__label'>{item.label}</Text>
                </View>
              )
            })}
          </View>
        </View>
      )}
    </Fragment>
  )
}
