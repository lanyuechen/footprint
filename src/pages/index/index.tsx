import { useDidShow } from '@tarojs/taro'
import { Textarea, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { TravelPlan } from '../../types'
import { EllipsisVertical } from 'lucide-react-taro/icons/ellipsis-vertical'
import { MapPinPlus } from 'lucide-react-taro/icons/map-pin-plus'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import {
  deletePlan,
  getAppDataExportJson,
  importAppDataJson,
  listPlans,
  mergePlans,
} from '../../services/storage'
import './index.scss'

function PlanCard({
  plan,
  menuOpen,
  onToggleMenu,
  onOpenDetail,
  onAddPlace,
  onEdit,
  onDelete,
}: {
  plan: TravelPlan
  menuOpen: boolean
  onToggleMenu: (id: string) => void
  onOpenDetail: (id: string) => void
  onAddPlace: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (plan: TravelPlan) => void
}) {
  return (
    <View className='plan-item' onClick={() => onOpenDetail(plan.id)}>
      <View className='plan-item__top'>
        <View className='plan-item__main'>
          <View className='plan-item__name'>{plan.name}</View>
          {!!plan.startDate && (
            <View className='plan-item__meta'>{plan.startDate}</View>
          )}
          {!!plan.description && (
            <View className='plan-item__desc'>{plan.description}</View>
          )}
        </View>
        <View className='plan-item__actions'>
          <View
            className='plan-item__add-place'
            onClick={(e) => {
              e.stopPropagation()
              onAddPlace(plan.id)
            }}
          >
            <MapPinPlus size={16} color='#1a5f4a' />
            <Text className='plan-item__add-place-text'>添加地点</Text>
          </View>
          <View className='plan-item__more-wrap'>
            <View
              className='plan-item__more'
              onClick={(e) => {
                e.stopPropagation()
                onToggleMenu(plan.id)
              }}
            >
              <EllipsisVertical size={18} color='#8a9199' />
            </View>
            {menuOpen && (
              <View
                className='plan-item__menu'
                onClick={(e) => e.stopPropagation()}
              >
                <View
                  className='plan-item__menu-item'
                  onClick={() => onEdit(plan.id)}
                >
                  <SquarePen size={16} color='#1a5f4a' />
                  <Text className='plan-item__menu-label'>编辑</Text>
                </View>
                <View
                  className='plan-item__menu-item plan-item__menu-item--danger'
                  onClick={() => onDelete(plan)}
                >
                  <Trash2 size={16} color='#c45656' />
                  <Text className='plan-item__menu-label plan-item__menu-label--danger'>
                    删除
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

export default function IndexPage() {
  const [plans, setPlans] = useState<TravelPlan[]>([])
  const [menuId, setMenuId] = useState<string | null>(null)
  const [exportJson, setExportJson] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<string[]>([])

  const refresh = () => {
    setPlans(listPlans())
  }

  useDidShow(() => {
    setMenuId(null)
    refresh()
  })

  const goCreate = () => {
    Taro.navigateTo({ url: '/pages/plan-edit/index' })
  }

  const goDetail = (id: string) => {
    setMenuId(null)
    Taro.navigateTo({ url: `/pages/plan-view/index?id=${id}` })
  }

  const goAddPlace = (id: string) => {
    setMenuId(null)
    Taro.navigateTo({ url: `/pages/place-add/index?id=${id}` })
  }

  const goEdit = (id: string) => {
    setMenuId(null)
    Taro.navigateTo({ url: `/pages/plan-edit/index?id=${id}` })
  }

  const onDelete = async (plan: TravelPlan) => {
    setMenuId(null)
    const { confirm } = await Taro.showModal({
      title: '删除计划',
      content: `确定删除「${plan.name}」？其下目标点将一并删除。`,
      confirmColor: '#c45656',
    })
    if (!confirm) return
    deletePlan(plan.id)
    Taro.showToast({ title: '已删除', icon: 'success' })
    refresh()
  }

  const onExport = () => {
    setImportOpen(false)
    setMergeOpen(false)
    setExportJson(getAppDataExportJson())
  }

  const onCopyExport = async () => {
    if (!exportJson) return
    try {
      await Taro.setClipboardData({ data: exportJson })
    } catch {
      Taro.showToast({ title: '复制失败', icon: 'none' })
    }
  }

  const onOpenImport = () => {
    setExportJson(null)
    setMergeOpen(false)
    setImportText('')
    setImportOpen(true)
  }

  const onOpenMerge = () => {
    if (plans.length < 2) {
      Taro.showToast({ title: '至少需要两个计划', icon: 'none' })
      return
    }
    setExportJson(null)
    setImportOpen(false)
    setMergeSelected([])
    setMergeOpen(true)
  }

  const toggleMergeSelect = (id: string) => {
    setMergeSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const onConfirmMerge = async () => {
    if (mergeSelected.length < 2) {
      Taro.showToast({ title: '请至少选择两个计划', icon: 'none' })
      return
    }
    const { confirm } = await Taro.showModal({
      title: '确认合并',
      content:
        '将生成一个新计划，原计划保留。地点去重复制，日程按选择顺序依次追加。',
      confirmText: '合并',
      confirmColor: '#1a5f4a',
    })
    if (!confirm) return
    const result = mergePlans(mergeSelected)
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    setMergeOpen(false)
    setMergeSelected([])
    refresh()
    Taro.showToast({
      title: `已生成「${result.plan.name}」`,
      icon: 'success',
    })
  }

  const onPasteImport = async () => {
    try {
      const { data } = await Taro.getClipboardData()
      setImportText(typeof data === 'string' ? data : '')
    } catch {
      Taro.showToast({ title: '读取剪贴板失败', icon: 'none' })
    }
  }

  const onConfirmImport = async () => {
    const { confirm } = await Taro.showModal({
      title: '确认导入',
      content: '将用导入的数据覆盖本地全部计划、地点与行程，此操作不可撤销。',
      confirmText: '导入',
      confirmColor: '#1a5f4a',
    })
    if (!confirm) return
    const result = importAppDataJson(importText)
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    setImportOpen(false)
    setImportText('')
    refresh()
    Taro.showToast({
      title: `已导入 ${result.planCount} 个计划`,
      icon: 'success',
    })
  }

  return (
    <View className='index' onClick={() => setMenuId(null)}>
      <View className='header'>
        <Text className='header__title'>我的计划</Text>
        <View className='header__actions'>
          <Text
            className='header__action'
            onClick={(e) => {
              e.stopPropagation()
              onOpenMerge()
            }}
          >
            合并
          </Text>
          <Text
            className='header__action'
            onClick={(e) => {
              e.stopPropagation()
              onOpenImport()
            }}
          >
            导入
          </Text>
          <Text
            className='header__action'
            onClick={(e) => {
              e.stopPropagation()
              onExport()
            }}
          >
            导出
          </Text>
        </View>
      </View>

      {plans.length === 0 ? (
        <View className='empty'>
          <Text className='empty__text'>还没有计划</Text>
          <Text className='empty__hint'>点击下方添加第一个旅行计划</Text>
        </View>
      ) : (
        <View className='plan-list'>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              menuOpen={menuId === plan.id}
              onToggleMenu={(id) =>
                setMenuId((prev) => (prev === id ? null : id))
              }
              onOpenDetail={goDetail}
              onAddPlace={goAddPlace}
              onEdit={goEdit}
              onDelete={onDelete}
            />
          ))}
        </View>
      )}

      <View className='add-plan' onClick={goCreate}>
        <Text className='add-plan__text'>+ 添加计划</Text>
      </View>

      {exportJson != null ? (
        <View
          className='export-mask'
          catchMove
          onClick={() => setExportJson(null)}
        >
          <View
            className='export-dialog'
            onClick={(e) => e.stopPropagation()}
          >
            <View className='export-dialog__head'>
              <Text className='export-dialog__title'>导出数据</Text>
              <Text
                className='export-dialog__close'
                onClick={() => setExportJson(null)}
              >
                关闭
              </Text>
            </View>
            <View className='export-dialog__body export-dialog__body--import'>
              <Text className='export-dialog__hint'>
                请用下方按钮复制；长按选中文本可能损坏空格导致无法导入
              </Text>
              <Textarea
                className='export-dialog__textarea'
                value={exportJson}
                maxlength={-1}
                disabled
                showConfirmBar={false}
              />
            </View>
            <View className='export-dialog__foot'>
              <View className='export-dialog__btn' onClick={onCopyExport}>
                <Text className='export-dialog__btn-text'>复制 JSON</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {importOpen ? (
        <View
          className='export-mask'
          catchMove
          onClick={() => setImportOpen(false)}
        >
          <View
            className='export-dialog'
            onClick={(e) => e.stopPropagation()}
          >
            <View className='export-dialog__head'>
              <Text className='export-dialog__title'>导入数据</Text>
              <Text
                className='export-dialog__close'
                onClick={() => setImportOpen(false)}
              >
                关闭
              </Text>
            </View>
            <View className='export-dialog__body export-dialog__body--import'>
              <Text className='export-dialog__hint'>
                粘贴此前导出的 JSON，将覆盖本地全部数据
              </Text>
              <Textarea
                className='export-dialog__textarea'
                value={importText}
                maxlength={-1}
                placeholder='在此粘贴导出的 JSON…'
                onInput={(e) => setImportText(e.detail.value)}
              />
            </View>
            <View className='export-dialog__foot export-dialog__foot--row'>
              <View
                className='export-dialog__btn export-dialog__btn--ghost'
                onClick={onPasteImport}
              >
                <Text className='export-dialog__btn-text export-dialog__btn-text--ghost'>
                  从剪贴板粘贴
                </Text>
              </View>
              <View className='export-dialog__btn' onClick={onConfirmImport}>
                <Text className='export-dialog__btn-text'>确认导入</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {mergeOpen ? (
        <View
          className='export-mask'
          catchMove
          onClick={() => setMergeOpen(false)}
        >
          <View
            className='export-dialog'
            onClick={(e) => e.stopPropagation()}
          >
            <View className='export-dialog__head'>
              <Text className='export-dialog__title'>合并计划</Text>
              <Text
                className='export-dialog__close'
                onClick={() => setMergeOpen(false)}
              >
                关闭
              </Text>
            </View>
            <View className='export-dialog__body export-dialog__body--merge'>
              <Text className='export-dialog__hint'>
                多选至少两个计划；按选择顺序合并生成新计划，原计划保留
              </Text>
              <View className='merge-list'>
                {plans.map((plan) => {
                  const selected = mergeSelected.includes(plan.id)
                  const order = mergeSelected.indexOf(plan.id)
                  return (
                    <View
                      key={plan.id}
                      className={
                        selected
                          ? 'merge-list__item merge-list__item--on'
                          : 'merge-list__item'
                      }
                      onClick={() => toggleMergeSelect(plan.id)}
                    >
                      <View
                        className={
                          selected
                            ? 'merge-list__check merge-list__check--on'
                            : 'merge-list__check'
                        }
                      >
                        {selected ? (
                          <Text className='merge-list__check-text'>
                            {order + 1}
                          </Text>
                        ) : null}
                      </View>
                      <View className='merge-list__main'>
                        <Text className='merge-list__name'>{plan.name}</Text>
                        <Text className='merge-list__meta'>
                          {[
                            plan.startDate || null,
                            order >= 0 ? `顺序 ${order + 1}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || ' '}
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
            <View className='export-dialog__foot'>
              <View
                className={
                  mergeSelected.length >= 2
                    ? 'export-dialog__btn'
                    : 'export-dialog__btn export-dialog__btn--disabled'
                }
                onClick={onConfirmMerge}
              >
                <Text className='export-dialog__btn-text'>
                  确定合并（{mergeSelected.length}）
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
