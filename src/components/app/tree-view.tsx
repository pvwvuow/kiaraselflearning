'use client'

/**
 * TreeView (M6) — the personal skill tree as a simple SVG map (docs/05 M6).
 *
 * - Deterministic layered layout comes from the server (`GET /api/tree`);
 *   positions are persistent, so two visits render identical positions.
 * - Node card: English title, Persian gloss, 4 skill mini-rings —
 *   listening/speaking render "—" (not tracked in the MVP).
 * - State colors per docs/05; fading has a NON-COLOR cue: dashed ring +
 *   the "why" panel. Locked nodes are dimmed.
 * - Selected node panel = the "why?" tooltip (evidence-based Persian reason)
 *   with pin/hide actions (PATCH /api/tree/:nodeId).
 * - Pan = pointer drag · zoom = buttons · keyboard: Tab to a node, Enter to
 *   open the panel, Esc to close.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Loader2,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Crosshair,
  RefreshCw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/client/api'
import type { TreeNodeView, TreeResponse, TreeDisplayState } from '@/lib/client/api'
import { faDigits } from '@/lib/client/format'
import { useAppStore } from '@/stores/app-store'

const NODE_W = 132
const NODE_H = 76
const RING_R = 5.5
const RING_C = 2 * Math.PI * RING_R
/** ring centers relative to the card's left edge (reading, writing, listening, speaking) */
const RING_CX = [27, 53, 79, 105]
const RING_CY = NODE_H - 15

const STATE_STYLE: Record<
  TreeDisplayState,
  { fill: string; stroke: string; dash?: string; dim?: boolean; label: string }
> = {
  locked: { fill: '#fafafa', stroke: '#c3c8d2', dim: true, label: 'قفل' },
  available: { fill: '#eff6ff', stroke: '#3b82f6', label: 'آماده‌ی شروع' },
  assumed_known: { fill: '#f5f3ff', stroke: '#8b5cf6', label: 'فرضِ دانستن' },
  learning: { fill: '#fffbeb', stroke: '#d97706', label: 'در حال یادگیری' },
  fading: { fill: '#fef2f2', stroke: '#dc2626', dash: '7 4', label: 'در حال فراموشی' },
  mastered: { fill: '#f0fdf4', stroke: '#16a34a', label: 'تسلط‌یافته' },
}

const SKILL_ORDER = ['reading', 'writing', 'listening', 'speaking'] as const
const SKILL_FA: Record<string, string> = {
  listening: 'شنیداری',
  speaking: 'گفتاری',
  reading: 'خواندنی',
  writing: 'نوشتاری',
}

const TYPE_FA: Record<string, string> = {
  word: 'واژه',
  chunk: 'عبارت',
  grammar_pattern: 'الگوی دستوری',
  pragmatic_skill: 'مهارت کاربردی',
  error_pattern: 'الگوی خطا',
  topic_cluster: 'خوشه‌ی موضوعی',
  sound_letter: 'صدا و حرف',
}

const TEXT_MAIN = '#3f3f46'
const TEXT_MUTED = '#6b7280'

const LIT_STATES: readonly TreeDisplayState[] = ['learning', 'fading', 'mastered', 'assumed_known']

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
}

export default function TreeView() {
  const setView = useAppStore((s) => s.setView)

  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.72)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    sx: number
    sy: number
    px: number
    py: number
    moved: boolean
    onNode: boolean
  } | null>(null)
  const didCenter = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTree(await api.tree())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خطای شبکه — دوباره تلاش کن.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** initial (and "recenter") target: the user's living region of the tree */
  const centerOnMyTree = useCallback((t: TreeResponse) => {
    const el = canvasRef.current
    const w = el?.clientWidth ?? window.innerWidth
    const h = el?.clientHeight ?? window.innerHeight - 56
    const lit = t.nodes.filter((n) => LIT_STATES.includes(n.state))
    const focus = lit.length > 0 ? lit : t.nodes.filter((n) => n.state === 'available')
    const pool = focus.length > 0 ? focus : t.nodes
    const cx = pool.reduce((s, n) => s + n.x + NODE_W / 2, 0) / pool.length
    const cy = pool.reduce((s, n) => s + n.y + NODE_H / 2, 0) / pool.length
    setPan({ x: w / 2 - cx * zoom, y: h / 2 - cy * zoom })
  }, [zoom])

  useEffect(() => {
    if (!tree || didCenter.current) return
    didCenter.current = true
    centerOnMyTree(tree)
  }, [tree, centerOnMyTree])

  // Esc closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleNodes = useMemo(
    () => tree?.nodes.filter((n) => showHidden || !n.hidden) ?? [],
    [tree, showHidden],
  )
  const byId = useMemo(() => new Map(visibleNodes.map((n) => [n.id, n])), [visibleNodes])
  const edges = useMemo(
    () => tree?.edges.filter((e) => byId.has(e.from) && byId.has(e.to)) ?? [],
    [tree, byId],
  )
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  const toggleFlag = async (node: TreeNodeView, flags: { pinned?: boolean; hidden?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.treeNodeFlags(node.id, flags)
      setTree((t) =>
        t
          ? {
              ...t,
              nodes: t.nodes.map((n) =>
                n.id === r.id ? { ...n, pinned: r.pinned, hidden: r.hidden } : n,
              ),
            }
          : t,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ثبت تغییر ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.target as Element
    // the details panel (and everything in it) never starts a drag / deselect
    if (el.closest('[data-testid=node-panel]')) return
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      px: pan.x,
      py: pan.y,
      moved: false,
      onNode: el.closest('[data-node-id]') !== null,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setPan({ x: d.px + dx, y: d.py + dy })
  }
  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    // plain background click (not a node card) = deselect
    if (d && !d.moved && !d.onNode) setSelectedId(null)
  }

  const litCount = tree ? tree.nodes.filter((n) => LIT_STATES.includes(n.state)).length : 0

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      {/* header */}
      <header className="border-b bg-background/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setView('home')} className="gap-1.5 shrink-0">
            <ArrowRight className="size-4" aria-hidden />
            خانه
          </Button>
          <h1 className="font-bold">درخت مهارت</h1>
          {tree && (
            <p className="text-xs text-muted-foreground">
              {faDigits(tree.stats.total)} گره · {faDigits(litCount)} روشن
              {tree.stats.hidden > 0 && <> · {faDigits(tree.stats.hidden)} مخفی</>}
            </p>
          )}
          <div className="ms-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="accent-primary size-3.5"
                aria-label="نمایش گره‌های مخفی‌شده"
              />
              مخفی‌ها
            </label>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => void load()} aria-label="بازخوانی">
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {/* canvas */}
      <div
        ref={canvasRef}
        className="relative flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {loading && (
          <div role="status" className="absolute inset-0 grid place-items-center gap-2 z-10">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
              <p className="text-sm">درخت در حال سبز شدن…</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div role="alert" className="absolute inset-x-0 top-4 z-10 mx-auto w-fit rounded-md border bg-background px-4 py-2 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}

        {tree && !loading && (
          <svg
            className="absolute inset-0 w-full h-full select-none touch-none"
            role="application"
            aria-label="نقشه‌ی درخت مهارت — برای جابه‌جایی بکشید"
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* prerequisite skeleton */}
              {edges.map((e) => {
                const a = byId.get(e.from)!
                const b = byId.get(e.to)!
                return (
                  <line
                    key={`${e.from}->${e.to}`}
                    x1={a.x + NODE_W / 2}
                    y1={a.y + NODE_H}
                    x2={b.x + NODE_W / 2}
                    y2={b.y}
                    stroke="#d4d4d8"
                    strokeWidth={1.4}
                    pointerEvents="none"
                  />
                )
              })}

              {visibleNodes.map((n) => (
                <TreeNodeCard
                  key={n.id}
                  node={n}
                  selected={n.id === selectedId}
                  onSelect={() => setSelectedId(n.id)}
                />
              ))}
            </g>
          </svg>
        )}

        {/* zoom controls */}
        {tree && !loading && (
          <div className="absolute bottom-4 start-4 z-10 flex flex-col gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="size-9 bg-background"
              aria-label="بزرگ‌نمایی"
              onClick={() => setZoom((z) => Math.min(2.5, z * 1.25))}
            >
              <ZoomIn className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9 bg-background"
              aria-label="کوچک‌نمایی"
              onClick={() => setZoom((z) => Math.max(0.45, z / 1.25))}
            >
              <ZoomOut className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9 bg-background"
              aria-label="نمایش ناحیه‌ی من"
              onClick={() => tree && centerOnMyTree(tree)}
            >
              <Crosshair className="size-4" aria-hidden />
            </Button>
          </div>
        )}

        {/* legend */}
        {tree && !loading && (
          <div
            className="absolute top-3 end-4 z-10 rounded-lg border bg-background/95 p-3 text-xs shadow-sm space-y-1.5"
            aria-label="راهنمای رنگ‌ها"
          >
            <p className="font-semibold text-[11px] text-muted-foreground">راهنما</p>
            {(Object.keys(STATE_STYLE) as TreeDisplayState[]).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <svg width="22" height="14" aria-hidden className="shrink-0">
                  <rect
                    x="1"
                    y="1"
                    width="20"
                    height="12"
                    rx="3"
                    fill={STATE_STYLE[s].fill}
                    stroke={STATE_STYLE[s].stroke}
                    strokeDasharray={STATE_STYLE[s].dash}
                    strokeWidth="1.5"
                  />
                </svg>
                <span className="text-foreground">{STATE_STYLE[s].label}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-5 pt-1 border-t">
              حلقه‌ی خط‌چین = فراموشی (نشانه‌ی غیررنگی)
              <br />
              حلقه‌های کوچک: خواندنی، نوشتاری، شنیداری، گفتاری
            </p>
          </div>
        )}

        {/* selected node panel — the "why?" tooltip with pin/hide */}
        {selected && (
          <aside
            data-testid="node-panel"
            aria-label={`جزئیات گره ${selected.title}`}
            className="absolute bottom-4 end-4 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-background shadow-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p dir="ltr" className="font-bold text-sm text-start">
                  {selected.title}
                  {selected.pinned && <Pin className="inline size-3.5 ms-1.5 text-green-700" aria-label="سنجاق‌شده" />}
                </p>
                {selected.glossFa && (
                  <p className="text-xs text-muted-foreground leading-6">{selected.glossFa}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setSelectedId(null)}
                aria-label="بستن"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className="rounded-full border px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: STATE_STYLE[selected.state].fill,
                  borderColor: STATE_STYLE[selected.state].stroke,
                  color: TEXT_MAIN,
                }}
              >
                {STATE_STYLE[selected.state].label}
              </span>
              {selected.cefr && (
                <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
                  {selected.cefr}
                </span>
              )}
              <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
                {TYPE_FA[selected.type] ?? selected.type}
              </span>
              {selected.userGenerated && (
                <span className="rounded-full border px-2 py-0.5 text-muted-foreground">کاشته‌شده</span>
              )}
            </div>

            <div className="rounded-md bg-muted/60 p-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">چرا؟</p>
              <p className="text-xs leading-6">{selected.why}</p>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {SKILL_ORDER.map((sk) => {
                const st = selected.skills[sk]
                return (
                  <div key={sk} className="flex items-center justify-between gap-1 border-b border-dotted pb-0.5">
                    <dt className="text-muted-foreground">{SKILL_FA[sk]}</dt>
                    <dd className="font-medium">
                      {st ? (
                        <>
                          {STATE_STYLE[st.state].label}
                          <span className="text-muted-foreground font-normal"> · {faDigits(Math.round(st.strength * 100))}٪</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                disabled={busy}
                onClick={() => void toggleFlag(selected, { pinned: !selected.pinned })}
              >
                {selected.pinned ? (
                  <>
                    <PinOff className="size-3.5" aria-hidden /> برداشتن سنجاق
                  </>
                ) : (
                  <>
                    <Pin className="size-3.5" aria-hidden /> سنجاق کن
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                disabled={busy}
                onClick={() => void toggleFlag(selected, { hidden: !selected.hidden })}
              >
                {selected.hidden ? (
                  <>
                    <Eye className="size-3.5" aria-hidden /> نمایش
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3.5" aria-hidden /> مخفی کن
                  </>
                )}
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

/** one SVG node card (title + gloss + 4 skill rings + state styling) */
function TreeNodeCard({
  node,
  selected,
  onSelect,
}: {
  node: TreeNodeView
  selected: boolean
  onSelect: () => void
}) {
  const st = STATE_STYLE[node.state]
  const fading = node.state === 'fading'

  return (
    <g
      data-node-id={node.id}
      data-state={node.state}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.title} — ${st.label}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="cursor-pointer focus-visible:outline-none"
      opacity={node.hidden ? 0.4 : st.dim ? 0.8 : 1}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={12}
        fill={st.fill}
        stroke={node.pinned ? '#15803d' : selected ? '#0f766e' : st.stroke}
        strokeWidth={selected || node.pinned ? 2.5 : 1.4}
        strokeDasharray={st.dash}
      />
      {fading && (
        // second, outer dashed ring — the explicit non-color fading cue
        <rect
          x={-3.5}
          y={-3.5}
          width={NODE_W + 7}
          height={NODE_H + 7}
          rx={14}
          fill="none"
          stroke="#dc2626"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.7}
          pointerEvents="none"
        />
      )}
      <text
        x={NODE_W / 2}
        y={27}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill={TEXT_MAIN}
        style={{ direction: 'ltr' }}
        pointerEvents="none"
      >
        {truncate(node.title, 17)}
      </text>
      {node.glossFa && (
        <text
          x={NODE_W / 2}
          y={45}
          textAnchor="middle"
          fontSize={10.5}
          fill={TEXT_MUTED}
          style={{ direction: 'rtl' }}
          pointerEvents="none"
        >
          {truncate(node.glossFa, 22)}
        </text>
      )}
      {SKILL_ORDER.map((sk, i) => {
        const cx = RING_CX[i]
        const skill = node.skills[sk]
        return (
          <g key={sk} pointerEvents="none">
            {skill ? (
              <>
                <circle cx={cx} cy={RING_CY} r={RING_R} fill="#fff" stroke="#d4d4d8" strokeWidth={1.2} />
                <circle
                  cx={cx}
                  cy={RING_CY}
                  r={RING_R}
                  fill="none"
                  stroke={STATE_STYLE[skill.state].stroke}
                  strokeWidth={3}
                  strokeDasharray={`${RING_C * Math.min(1, Math.max(0.08, skill.strength))} ${RING_C}`}
                  transform={`rotate(-90 ${cx} ${RING_CY})`}
                  strokeLinecap="round"
                />
              </>
            ) : (
              <>
                <circle cx={cx} cy={RING_CY} r={RING_R} fill="none" stroke="#d4d4d8" strokeWidth={1.2} />
                <text
                  x={cx}
                  y={RING_CY + 3}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#a1a1aa"
                  style={{ direction: 'ltr' }}
                >
                  —
                </text>
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}
