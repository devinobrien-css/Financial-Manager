'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type SelectOption = {
  value: string
  label: string
  sublabel?: string
  color?: string
  icon?: React.ElementType
}

interface CustomSelectProps {
  value: string
  onChange: (val: string) => void
  options: SelectOption[]
  placeholder?: string
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = '— Select —',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const dropdownHeight = Math.min(options.length * 52 + 8, 224)
    const openUpward = spaceBelow < dropdownHeight && rect.top > dropdownHeight
    const minW = Math.max(rect.width, 280)
    setDropdownStyle({
      position: 'fixed',
      top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - minW - 12),
      minWidth: minW,
      maxWidth: 420,
      zIndex: 9999,
    })
    setOpen(o => !o)
  }

  const selected = options.find(o => o.value === value)

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.color && (
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected.color }} />
          )}
          {selected?.icon && (() => { const Icon = selected.icon!; return <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" /> })()}
          {selected?.sublabel ? (
            <span className="flex flex-col items-start min-w-0">
              <span className="text-sm text-slate-800 leading-tight truncate w-full">{selected.label}</span>
              <span className="text-xs text-slate-400 leading-tight truncate w-full">{selected.sublabel}</span>
            </span>
          ) : (
            <span className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
              {selected ? selected.label : placeholder}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div ref={dropdownRef} style={dropdownStyle} className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(o => {
              const Icon = o.icon
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors hover:bg-slate-50 ${
                    value === o.value ? 'bg-slate-50' : ''
                  }`}
                >
                  {o.color && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: o.color }} />
                  )}
                  {Icon && <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate ${value === o.value ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                      {o.label}
                    </span>
                    {o.sublabel && (
                      <span className="block text-xs text-slate-400 leading-snug">{o.sublabel}</span>
                    )}
                  </span>
                  {value === o.value && <Check className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
