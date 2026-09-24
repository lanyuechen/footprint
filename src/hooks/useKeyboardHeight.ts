import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'

/** 监听键盘高度；用于底部弹层上移，避免 adjustPosition 整页跳动 */
export function useKeyboardHeight(active: boolean): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!active) {
      setHeight(0)
      return
    }
    const onChange = (res: { height: number }) => {
      setHeight(Math.max(0, Math.round(res.height || 0)))
    }
    Taro.onKeyboardHeightChange(onChange)
    return () => {
      Taro.offKeyboardHeightChange(onChange)
      setHeight(0)
    }
  }, [active])

  return height
}
