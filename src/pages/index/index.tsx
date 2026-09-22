import { useDidShow } from '@tarojs/taro'
import { Textarea, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { TravelPlan } from '../../types'
import { EllipsisVertical } from 'lucide-react-taro/icons/ellipsis-vertical'
import { Share2 } from 'lucide-react-taro/icons/share-2'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import {
  deletePlan,
  getAppDataExportJson,
  getPlan,
  importAppDataJson,
  listAllPlacesByPlan,
  listPlans,
  listStopsByPlan,
  mergePlans,
} from '../../services/storage'
import { planToMarkdown } from '../../utils/plan-markdown'
import { useDropdownAnim } from '../../hooks/useDropdownAnim'
import './index.scss'

function PlanCard({
  plan,
  menuOpen,
  onToggleMenu,
  onOpenDetail,
  onShare,
  onEdit,
  onDelete,
}: {
  plan: TravelPlan
  menuOpen: boolean
  onToggleMenu: (id: string) => void
  onOpenDetail: (id: string) => void
  onShare: (plan: TravelPlan) => void
  onEdit: (id: string) => void
  onDelete: (plan: TravelPlan) => void
}) {
  const { mounted, shown } = useDropdownAnim(menuOpen)

  return (
    <View
      className={`plan-item${mounted ? ' plan-item--menu-open' : ''}`}
      onClick={() => onOpenDetail(plan.id)}
    >
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
            {mounted ? (
              <View
                className={`plan-item__menu${
                  shown ? ' plan-item__menu--open' : ''
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <View
                  className='plan-item__menu-item'
                  onClick={() => onShare(plan)}
                >
                  <Share2 size={16} color='#1a5f4a' />
                  <Text className='plan-item__menu-label'>分享</Text>
                </View>
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
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
}

export default function IndexPage() {
  const [plans, setPlans] = useState<TravelPlan[]>([])
  const [menuId, setMenuId] = useState<string | null>(null)
  const [shareMarkdown, setShareMarkdown] = useState<string | null>(null)
  const [shareTitle, setShareTitle] = useState('')
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
    Taro.navigateTo({ url: `/pages/trip-edit/index?id=${id}` })
  }

  const goEdit = (id: string) => {
    setMenuId(null)
    Taro.navigateTo({ url: `/pages/plan-edit/index?id=${id}` })
  }

  const onShare = (plan: TravelPlan) => {
    setMenuId(null)
    const latest = getPlan(plan.id) || plan
    const md = planToMarkdown(
      latest,
      listStopsByPlan(latest.id),
      listAllPlacesByPlan(latest.id),
    )
    setMergeOpen(false)
    setShareTitle(latest.name || '未命名计划')
    setShareMarkdown(md)
  }

  const onCopyShare = async () => {
    if (!shareMarkdown) return
    try {
      await Taro.setClipboardData({ data: shareMarkdown })
    } catch {
      Taro.showToast({ title: '复制失败', icon: 'none' })
    }
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

  const onExportToFile = async () => {
    setShareMarkdown(null)
    setMergeOpen(false)
    try {
      const json = getAppDataExportJson()
      const stamp = (() => {
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        return (
          `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
          `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
        )
      })()
      const fileName = `footprint-${stamp}.json`
      const filePath = `${Taro.env.USER_DATA_PATH}/${fileName}`
      // 同步写入，避免打断点击手势导致 shareFileMessage 失败
      Taro.getFileSystemManager().writeFileSync(filePath, json, 'utf8')

      const platform =
        Taro.getDeviceInfo?.().platform ||
        Taro.getSystemInfoSync().platform ||
        ''
      // 开发者工具不支持转发文件，降级为复制 JSON
      if (platform === 'devtools') {
        await Taro.setClipboardData({ data: json })
        Taro.showToast({
          title: '模拟器已复制 JSON，真机可转发文件',
          icon: 'none',
          duration: 2500,
        })
        return
      }

      await Taro.shareFileMessage({
        filePath,
        fileName,
      })
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' &&
              err &&
              'errMsg' in err &&
              typeof (err as { errMsg?: string }).errMsg === 'string'
            ? (err as { errMsg: string }).errMsg
            : ''
      if (/cancel|取消/i.test(msg)) return
      try {
        await Taro.setClipboardData({ data: getAppDataExportJson() })
        Taro.showToast({
          title: '转发失败，已复制 JSON',
          icon: 'none',
          duration: 2500,
        })
      } catch {
        Taro.showToast({
          title: msg.includes('fail') ? '导出失败' : msg || '导出失败',
          icon: 'none',
        })
      }
    }
  }

  const readJsonFile = (filePath: string): Promise<string> =>
    new Promise((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf8',
        success: (res) => {
          const data = res.data
          resolve(typeof data === 'string' ? data : '')
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '读取文件失败'))
        },
      })
    })

  const onImportFromFile = async () => {
    setShareMarkdown(null)
    setMergeOpen(false)
    try {
      const picked = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json'],
      })
      const file = picked.tempFiles?.[0]
      if (!file?.path) {
        Taro.showToast({ title: '未选择文件', icon: 'none' })
        return
      }
      const name = file.name || '所选文件'
      const raw = await readJsonFile(file.path)
      if (!raw.trim()) {
        Taro.showToast({ title: '文件为空', icon: 'none' })
        return
      }
      const { confirm } = await Taro.showModal({
        title: '确认导入',
        content: `将用「${name}」覆盖本地全部计划、地点与行程，此操作不可撤销。`,
        confirmText: '导入',
        confirmColor: '#1a5f4a',
      })
      if (!confirm) return
      const result = importAppDataJson(raw)
      if (!result.ok) {
        Taro.showToast({ title: result.message, icon: 'none' })
        return
      }
      refresh()
      Taro.showToast({
        title: `已导入 ${result.planCount} 个计划`,
        icon: 'success',
      })
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' &&
              err &&
              'errMsg' in err &&
              typeof (err as { errMsg?: string }).errMsg === 'string'
            ? (err as { errMsg: string }).errMsg
            : ''
      if (/cancel|取消/i.test(msg)) return
      Taro.showToast({
        title: msg.includes('fail') ? '选择或读取文件失败' : msg || '导入失败',
        icon: 'none',
      })
    }
  }

  const onOpenMerge = () => {
    if (plans.length < 2) {
      Taro.showToast({ title: '至少需要两个计划', icon: 'none' })
      return
    }
    setShareMarkdown(null)
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
              onImportFromFile()
            }}
          >
            导入
          </Text>
          <Text
            className='header__action'
            onClick={(e) => {
              e.stopPropagation()
              onExportToFile()
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
              onShare={onShare}
              onEdit={goEdit}
              onDelete={onDelete}
            />
          ))}
        </View>
      )}

      <View className='add-plan' onClick={goCreate}>
        <Text className='add-plan__text'>+ 添加计划</Text>
      </View>

      {shareMarkdown != null ? (
        <View
          className='export-mask'
          catchMove
          onClick={() => setShareMarkdown(null)}
        >
          <View
            className='export-dialog'
            onClick={(e) => e.stopPropagation()}
          >
            <View className='export-dialog__head'>
              <Text className='export-dialog__title'>
                分享 · {shareTitle}
              </Text>
              <Text
                className='export-dialog__close'
                onClick={() => setShareMarkdown(null)}
              >
                关闭
              </Text>
            </View>
            <View className='export-dialog__body export-dialog__body--import'>
              <Text className='export-dialog__hint'>
                已生成 Markdown，复制后可贴到备忘录、微信等分享
              </Text>
              <Textarea
                className='export-dialog__textarea'
                value={shareMarkdown}
                maxlength={-1}
                disabled
                showConfirmBar={false}
              />
            </View>
            <View className='export-dialog__foot'>
              <View className='export-dialog__btn' onClick={onCopyShare}>
                <Text className='export-dialog__btn-text'>复制 Markdown</Text>
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
