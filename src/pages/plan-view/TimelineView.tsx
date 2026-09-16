import { View, Text, ScrollView, RichText } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { Star } from 'lucide-react-taro/icons/star'
import { useEffect, useRef, useState } from 'react'
import type { TargetPoint, TravelPlan } from '../../types'
import { formatClock, formatPlanSummary, spanDays } from '../../utils/datetime'
import { lightenColor, placeAxisMark } from './place-axis'
import { placeInfoRows } from './place-info'
import { TimeScrubber, type CardOrigin, type TimeScrubberHandle } from './TimeScrubber'
import { buildHourSlots } from './time-scrub'
import { groupPointsByYear } from './timeline-model'

type TimelineViewProps = {
  plan: TravelPlan
  points: TargetPoint[]
  expandedId: string
  focusCardId: string
  deferredUncollectIds: Set<string>
  onToggleExpanded: (id: string) => void
  onToggleCollected: (point: TargetPoint) => void
  onReschedule: (pointId: string, expectedAt: string) => void
}

export function TimelineView({
  plan,
  points,
  expandedId,
  focusCardId,
  deferredUncollectIds,
  onToggleExpanded,
  onToggleCollected,
  onReschedule,
}: TimelineViewProps) {
  const [scrub, setScrub] = useState<{
    point: TargetPoint
    origin: CardOrigin
    startFingerY: number
  } | null>(null)
  const fingerYRef = useRef(0)
  const scrubberRef = useRef<TimeScrubberHandle>(null)
  const scrubbingRef = useRef(false)
  const pendingReleaseRef = useRef(false)
  const ignoreClickRef = useRef(false)

  const rememberFinger = (y: number) => {
    fingerYRef.current = y
  }

  const startScrub = (point: TargetPoint, y: number) => {
    if (deferredUncollectIds.has(point.id)) {
      Taro.showToast({ title: '请先恢复收藏', icon: 'none' })
      return
    }
    if (buildHourSlots(points).length === 0) {
      Taro.showToast({ title: '无法读取时间', icon: 'none' })
      return
    }
    ignoreClickRef.current = true
    scrubbingRef.current = true
    rememberFinger(y)
    try {
      Taro.vibrateShort({ type: 'medium' })
    } catch {
      /* 旧基础库没有短震动 */
    }
    const page = Taro.getCurrentInstance().page
    const query = page ? Taro.createSelectorQuery().in(page) : Taro.createSelectorQuery()
    query
      .select(`#tl-card-${point.id}`)
      .boundingClientRect()
      .exec((res) => {
        const rect = res?.[0] as CardOrigin | undefined
        if (!scrubbingRef.current) return
        if (!rect?.width) {
          scrubbingRef.current = false
          Taro.showToast({ title: '无法读取卡片位置', icon: 'none' })
          return
        }
        setScrub({
          point,
          origin: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          startFingerY: y || fingerYRef.current,
        })
      })
  }

  const endScrub = () => {
    if (!scrubbingRef.current) return
    if (scrubberRef.current) scrubberRef.current.release()
    else pendingReleaseRef.current = true
  }

  useEffect(() => {
    if (!scrub || !pendingReleaseRef.current) return
    pendingReleaseRef.current = false
    scrubberRef.current?.release()
  }, [scrub])

  return (
    <View className={`timeline-view${scrub ? ' timeline-view--scrubbing' : ''}`}>
      <View className='timeline-view__hero'>
        <Text className='timeline-view__title'>{plan.name}</Text>
        {!!plan.description ? (
          <Text className='timeline-view__desc'>{plan.description}</Text>
        ) : (
          <Text className='timeline-view__desc timeline-view__desc--muted'>
            暂无描述
          </Text>
        )}
        <View className='timeline-view__meta'>
          {formatPlanSummary(points.length, spanDays(points.map((point) => point.expectedAt)))}
        </View>
      </View>

      <ScrollView
        scrollY={!scrub}
        enhanced
        usingSticky
        scrollWithAnimation
        scrollIntoView={focusCardId ? `tl-item-${focusCardId}` : ''}
        className='timeline-view__scroll'
      >
        {points.length === 0 ? (
          <View className='timeline-view__empty'>还没有收藏地点</View>
        ) : (
          <View className='timeline'>
            {groupPointsByYear(points).map((year, yearIndex, years) => (
              <View key={year.key} className='timeline__year'>
                <View className='timeline__sticky timeline__sticky--year'>
                  <View className='timeline__item timeline__item--year'>
                    <View className='timeline__rail'>
                      <View
                        className={`timeline__line${
                          yearIndex === 0 ? ' timeline__line--start' : ''
                        }`}
                      />
                      <View className='timeline__dot timeline__dot--year' />
                    </View>
                    <View className='timeline__year-label'>{year.label}</View>
                  </View>
                </View>
                {year.days.map((day, dayIndex) => {
                  return (
                    <View key={day.key} className='timeline__day-group'>
                      <View className='timeline__sticky timeline__sticky--day'>
                        <View className='timeline__item timeline__item--day'>
                          <View className='timeline__rail'>
                            <View className='timeline__line' />
                            <View className='timeline__dot timeline__dot--day' />
                          </View>
                          <View className='timeline__day'>
                            {day.label}
                            <Text className='timeline__weekday'>{day.weekday}</Text>
                          </View>
                        </View>
                      </View>
                      {day.points.map((point, index) => {
                        const collected = !deferredUncollectIds.has(point.id)
                        const axisMark = placeAxisMark(point.place)
                        const AxisIcon = axisMark.icon
                        const isLast =
                          yearIndex === years.length - 1 &&
                          dayIndex === year.days.length - 1 &&
                          index === day.points.length - 1
                        return (
                          <View
                            key={point.id}
                            id={`tl-item-${point.id}`}
                            className={`timeline__item${
                              isLast ? ' timeline__item--last' : ''
                            }`}
                          >
                            <View className='timeline__rail'>
                              <View
                                className={`timeline__line${
                                  isLast ? ' timeline__line--end' : ''
                                }`}
                              />
                              <View
                                className='timeline__dot timeline__dot--point'
                                style={{ backgroundColor: lightenColor(axisMark.color) }}
                              >
                                <AxisIcon size={14} color={axisMark.color} />
                              </View>
                            </View>
                            <View
                              id={`tl-card-${point.id}`}
                              className={`timeline__card${
                                expandedId === point.id ? ' timeline__card--open' : ''
                              }${scrub?.point.id === point.id ? ' timeline__card--lifted' : ''}`}
                              onTouchStart={(e) => {
                                const t = e.touches[0]
                                if (t) rememberFinger(t.clientY)
                              }}
                              onTouchMove={(e) => {
                                const t = e.touches[0]
                                if (t) rememberFinger(t.clientY)
                              }}
                              onTouchEnd={endScrub}
                              onLongPress={(e) => {
                                const t = e.touches?.[0]
                                startScrub(point, t?.clientY ?? fingerYRef.current)
                              }}
                              onClick={() => {
                                if (ignoreClickRef.current) {
                                  ignoreClickRef.current = false
                                  return
                                }
                                onToggleExpanded(expandedId === point.id ? '' : point.id)
                              }}
                            >
                              <View className='timeline__head'>
                                <View className='timeline__main'>
                                  <View className='timeline__time'>
                                    {formatClock(point.expectedAt)}
                                  </View>
                                  <View className='timeline__name'>{point.place.name}</View>
                                  {!!point.place.address && (
                                    <View className='timeline__addr'>
                                      {point.place.address}
                                    </View>
                                  )}
                                </View>
                                <View
                                  className='timeline__nav'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    Taro.navigateTo({
                                      url: `/pages/nav/index?pointId=${point.id}`,
                                    })
                                  }}
                                >
                                  <Navigation size={16} color='#1a5f4a' />
                                </View>
                                <View
                                  className='collect-star'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onToggleCollected(point)
                                  }}
                                >
                                  <Star
                                    size={18}
                                    color='#eab308'
                                    filled={collected}
                                  />
                                </View>
                              </View>
                              <View className='timeline__detail'>
                                <View className='timeline__detail-inner'>
                                  {placeInfoRows(point.place).map((row) => (
                                    <View key={row.label} className='timeline__info-row'>
                                      <View className='timeline__info-label'>{row.label}</View>
                                      <View className='timeline__info-value'>{row.value}</View>
                                    </View>
                                  ))}
                                  <View className='timeline__detail-divider' />
                                  {point.noteHtml?.trim() ? (
                                    <RichText
                                      className='timeline__detail-html'
                                      nodes={point.noteHtml}
                                    />
                                  ) : point.noteText?.trim() ? (
                                    <View className='timeline__detail-text'>
                                      {point.noteText}
                                    </View>
                                  ) : (
                                    <View className='timeline__detail-empty'>暂无备注</View>
                                  )}
                                </View>
                              </View>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  )
                })}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      {scrub ? (
        <TimeScrubber
          ref={scrubberRef}
          point={scrub.point}
          points={points}
          origin={scrub.origin}
          startFingerY={scrub.startFingerY}
          expanded={expandedId === scrub.point.id}
          collected={!deferredUncollectIds.has(scrub.point.id)}
          fingerYRef={fingerYRef}
          onConfirm={(expectedAt) => {
            scrubbingRef.current = false
            onReschedule(scrub.point.id, expectedAt)
            setScrub(null)
          }}
          onCancel={() => {
            scrubbingRef.current = false
            setScrub(null)
          }}
        />
      ) : null}
    </View>
  )
}
