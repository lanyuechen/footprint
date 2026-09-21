import { useEffect, useState } from 'react'

const DROPDOWN_MS = 220

/**
 * 下拉展开/收起：先挂载再加 --open；收起先去掉 --open，动画后再卸载。
 */
export function useDropdownAnim(open: boolean) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const t = setTimeout(() => setShown(true), 16)
      return () => clearTimeout(t)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), DROPDOWN_MS)
    return () => clearTimeout(t)
  }, [open])

  return { mounted, shown }
}

export const DROPDOWN_ANIM_MS = DROPDOWN_MS
