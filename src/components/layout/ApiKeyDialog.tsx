import { useState, useEffect, useRef, type ReactNode } from 'react'
import { X, Eye, EyeOff, Server, Lock, Loader2, Plus, Trash2, RefreshCw, Activity, CircleCheck, CircleX, CircleMinus, ArrowRightLeft, Cpu, PanelsTopLeft, ShieldCheck } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import type { ProviderConfig } from '@/hooks/useSettings'
import { listProviderModels, testProviderConnectionFn } from '@/server/functions/settings'
import type { ConnectionTestResult } from '@/server/providers'
import { encryptPasswordFn } from '@/server/functions/crypto'
import {
  createCustomProviderId,
  formatModelList,
  parseModelList,
  PROVIDER_TEMPLATES,
  THINKING_STYLE_LABELS,
  validateBaseURL,
  type CustomProvider,
  type ProviderModel,
  type ProviderTemplate,
  type ServerProvider,
  type ThinkingStyle,
} from '@/lib/providers'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
}

interface ServerDraft {
  apiKeyInput: string
  baseURLInput: string
  hasSavedKey: boolean
}

interface CustomDraft {
  id: string
  name: string
  baseURL: string
  apiKeyInput: string
  /** Encrypted key already stored for this provider. */
  savedApiKey: string
  modelsText: string
  thinkingStyle: ThinkingStyle
}

const EMPTY_SERVER_DRAFT: ServerDraft = { apiKeyInput: '', baseURLInput: '', hasSavedKey: false }
const ADD_TAB = '__add__'

type SettingsSection = 'models' | 'display' | 'sql'

const inputClass = 'w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5'
const hintClass = 'text-xs text-gray-500 mt-1.5'

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

function CollapseToggle({ value, onChange, label }: { value: 'expanded' | 'collapsed'; onChange: (v: 'expanded' | 'collapsed') => void; label: string }) {
  const options = [['expanded', '展开'], ['collapsed', '折叠']] as const
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === v ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function toCustomDraft(p: CustomProvider): CustomDraft {
  return {
    id: p.id,
    name: p.name,
    baseURL: p.baseURL,
    apiKeyInput: '',
    savedApiKey: p.apiKey,
    modelsText: formatModelList(p.models),
    thinkingStyle: p.thinkingStyle,
  }
}

function validateCustomDraft(d: CustomDraft): string | null {
  if (!d.name.trim()) return '请填写服务名称'
  if (!d.baseURL.trim()) return '请填写 Base URL'
  const urlError = validateBaseURL(d.baseURL)
  if (urlError) return urlError
  if (!d.apiKeyInput.trim() && !d.savedApiKey) return '请填写 API Key'
  if (parseModelList(d.modelsText).length === 0) return '请至少添加一个模型'
  return null
}

function ApiKeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'sk-...'}
        autoComplete="off"
        className={`${inputClass} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
        aria-label={show ? '隐藏密钥' : '显示密钥'}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

function SavedKeyNotice({ onClear }: { onClear: () => void }) {
  return (
    <div className="mt-1.5 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-xs text-primary" title="使用 AES-256-GCM 加密后保存在本地">
        <Lock className="w-3.5 h-3.5" />
        <span>已加密保存</span>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded px-1.5 py-0.5 text-xs text-gray-500 underline-offset-2 transition-colors hover:text-red-600 hover:underline"
      >
        清除已保存的 Key
      </button>
    </div>
  )
}

interface ConnectionRequest {
  provider: string
  apiKey?: string
  baseURL?: string
  thinkingStyle?: ThinkingStyle
}

async function encryptIfTyped(typed: string, saved: string | undefined): Promise<string | undefined> {
  const trimmed = typed.trim()
  if (trimmed) return (await encryptPasswordFn({ data: { password: trimmed } })).encrypted
  return saved || undefined
}

/** Probes the request shapes the app depends on, using the values currently in the form. */
/** Saves the dialog, switches the chat to this provider + model and closes; resolves to an error message on failure. */
type UseModelHandler = (modelId: string) => Promise<string | null>

function ConnectionTester({ models, buildRequest, currentModel, onUseModel }: {
  models: ProviderModel[]
  /** Throws an Error whose message explains what is missing. */
  buildRequest: () => Promise<ConnectionRequest>
  /** The chat's current model when this provider is the active one. */
  currentModel?: string
  onUseModel?: UseModelHandler
}) {
  const [selected, setSelected] = useState('')
  const [running, setRunning] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const [error, setError] = useState('')
  const model = models.some((m) => m.id === selected) ? selected : (models[0]?.id ?? '')

  const handleTest = async () => {
    setError('')
    setResult(null)
    if (!model) { setError('请先添加至少一个模型'); return }
    setRunning(true)
    try {
      const request = await buildRequest()
      setResult(await testProviderConnectionFn({ data: { ...request, model } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败，请重试')
    } finally {
      setRunning(false)
    }
  }

  const handleUseModel = async (modelId: string) => {
    if (!onUseModel) return
    setError('')
    setSwitching(true)
    try {
      const failure = await onUseModel(modelId)
      if (failure) setError(failure)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-gray-700">连接测试</span>
        <select
          value={model}
          onChange={(e) => { setSelected(e.target.value); setResult(null) }}
          disabled={running || models.length === 0}
          aria-label="测试使用的模型"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-mono outline-none focus:border-primary"
        >
          {models.length === 0 && <option value="">尚未添加模型</option>}
          {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
        <button
          type="button"
          onClick={handleTest}
          disabled={running}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          {running ? '测试中…' : '测试连接'}
        </button>
      </div>
      <p className="text-xs text-gray-500">使用当前填写（未保存）的配置，依次检查流式工具调用、JSON 输出与思考参数，会产生少量 token 消耗。</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {result && (
        <ul className="space-y-1.5" aria-label="连接测试结果">
          {result.checks.map((check) => (
            <li key={check.key} className="flex items-start gap-1.5 text-xs">
              {check.status === 'pass' && <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-green-600" />}
              {check.status === 'fail' && <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" />}
              {check.status === 'skip' && <CircleMinus className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400" />}
              <div className="min-w-0">
                <span className={check.status === 'fail' ? 'text-red-700' : 'text-gray-700'}>{check.label}</span>
                {check.latencyMs !== undefined && <span className="ml-1 text-gray-400 tabular-nums">{(check.latencyMs / 1000).toFixed(1)}s</span>}
                {check.detail && <div className="break-words text-gray-500">{check.detail}</div>}
              </div>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 pt-0.5">
            <span className={`min-w-0 break-words text-xs font-medium ${result.ok ? 'text-green-700' : 'text-amber-700'}`}>
              {result.ok ? `模型 ${result.model} 可用` : '存在未通过的检查项，对话可能失败'}
            </span>
            {result.ok && onUseModel && (currentModel === result.model ? (
              <span className="flex shrink-0 items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700">
                <CircleCheck className="h-3.5 w-3.5" />
                当前模型
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleUseModel(result.model)}
                disabled={switching}
                title="保存设置，并在对话中切换到此模型"
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                设为当前模型
              </button>
            ))}
          </li>
        </ul>
      )}
    </div>
  )
}

function ServerProviderForm({ provider, draft, savedApiKey, currentModel, onUseModel, onChange, onClearKey }: {
  provider: ServerProvider
  draft: ServerDraft
  savedApiKey?: string
  currentModel?: string
  onUseModel: UseModelHandler
  onChange: (partial: Partial<ServerDraft>) => void
  onClearKey: () => void
}) {
  const hasAnyKey = draft.hasSavedKey || provider.hasEnvKey
  return (
    <div className="space-y-5">
      <SectionHeader title={provider.name} description="内置模型服务，模型列表由服务器配置。" />

      {provider.hasEnvKey && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <Server className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-700">
            <p className="font-medium">服务器已配置 API Key</p>
            <p className="mt-0.5 text-blue-600">服务器密钥仅在服务端使用，不会保存到浏览器。</p>
            <p className="mt-1 text-blue-500">
              {draft.hasSavedKey ? '当前使用浏览器本地保存的 Key（优先级更高）' : '如需覆盖，可在下方输入新的 Key'}
            </p>
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>
          {provider.hasEnvKey ? '自定义 API Key（可选）' : `${provider.name} API Key`}
        </label>
        <ApiKeyInput value={draft.apiKeyInput} onChange={(v) => onChange({ apiKeyInput: v })} />
        {draft.hasSavedKey && <SavedKeyNotice onClear={onClearKey} />}
        {!hasAnyKey && (
          <p className="mt-1.5 text-xs text-amber-700">
            未检测到 {provider.name} 的 API Key，请输入后保存，或联系管理员在服务器配置
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>自定义 Base URL（可选）</label>
        <input
          type="text"
          value={draft.baseURLInput}
          onChange={(e) => onChange({ baseURLInput: e.target.value })}
          placeholder={provider.defaultBaseURL ?? '服务器配置的地址'}
          className={`${inputClass} font-mono`}
        />
        <p className={hintClass}>
          留空则使用服务器配置的地址。填写自定义地址时，需要同时提供自有 API Key。
        </p>
      </div>

      <ConnectionTester
        models={provider.models}
        currentModel={currentModel}
        onUseModel={onUseModel}
        buildRequest={async () => {
          const baseURL = draft.baseURLInput.trim()
          if (baseURL) {
            const urlError = validateBaseURL(baseURL)
            if (urlError) throw new Error(urlError)
          }
          return {
            provider: provider.id,
            apiKey: await encryptIfTyped(draft.apiKeyInput, draft.hasSavedKey ? savedApiKey : undefined),
            baseURL: baseURL || undefined,
          }
        }}
      />
    </div>
  )
}

function CustomProviderForm({ draft, currentModel, onUseModel, onChange, onRemove }: {
  draft: CustomDraft
  currentModel?: string
  onUseModel: UseModelHandler
  onChange: (partial: Partial<CustomDraft>) => void
  onRemove: () => void
}) {
  const [fetching, setFetching] = useState(false)
  const [fetchMessage, setFetchMessage] = useState('')

  const handleFetchModels = async () => {
    setFetchMessage('')
    const urlError = validateBaseURL(draft.baseURL)
    if (urlError) { setFetchMessage(urlError); return }
    const typedKey = draft.apiKeyInput.trim()
    if (!typedKey && !draft.savedApiKey) { setFetchMessage('请先填写 API Key'); return }
    setFetching(true)
    try {
      const apiKey = await encryptIfTyped(typedKey, draft.savedApiKey)
      const ids = await listProviderModels({ data: { provider: draft.id, apiKey, baseURL: draft.baseURL.trim(), thinkingStyle: draft.thinkingStyle } })
      const existing = parseModelList(draft.modelsText)
      const known = new Set(existing.map((m) => m.id))
      const added = ids.filter((id) => !known.has(id))
      onChange({ modelsText: formatModelList([...existing, ...added.map((id) => ({ id }))]) })
      setFetchMessage(ids.length === 0 ? '服务未返回任何模型，请手动填写' : `已获取 ${ids.length} 个模型，新增 ${added.length} 个；可删除不需要的行`)
    } catch (err) {
      setFetchMessage(err instanceof Error ? `获取失败：${err.message}` : '获取失败，请手动填写模型 ID')
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={draft.name.trim() || '新服务'}
        description="自定义 OpenAI 兼容服务"
        action={(
          <button
            type="button"
            onClick={onRemove}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除服务
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>服务名称</label>
          <input type="text" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="例如：阿里云百炼" maxLength={50} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>思考参数</label>
          <select
            value={draft.thinkingStyle}
            onChange={(e) => onChange({ thinkingStyle: e.target.value as ThinkingStyle })}
            className={inputClass}
          >
            {(Object.keys(THINKING_STYLE_LABELS) as ThinkingStyle[]).map((style) => (
              <option key={style} value={style}>{THINKING_STYLE_LABELS[style].label}</option>
            ))}
          </select>
          <p className={hintClass}>{THINKING_STYLE_LABELS[draft.thinkingStyle].hint}</p>
        </div>
      </div>

      <div>
        <label className={labelClass}>Base URL</label>
        <input
          type="text"
          value={draft.baseURL}
          onChange={(e) => onChange({ baseURL: e.target.value })}
          placeholder="https://example.com/v1"
          className={`${inputClass} font-mono`}
        />
        <p className={hintClass}>OpenAI 兼容地址，请求将发送到 {'{Base URL}'}/chat/completions</p>
      </div>

      <div>
        <label className={labelClass}>API Key</label>
        <ApiKeyInput
          value={draft.apiKeyInput}
          onChange={(v) => onChange({ apiKeyInput: v })}
          placeholder={draft.savedApiKey ? '已保存，留空则保持不变' : 'sk-...'}
        />
        {draft.savedApiKey && <SavedKeyNotice onClear={() => onChange({ savedApiKey: '' })} />}
        <p className={hintClass}>自定义服务只使用你自己的 Key，服务器密钥不会用于此服务。</p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">模型</label>
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={fetching}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
          >
            {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            从服务获取
          </button>
        </div>
        <textarea
          value={draft.modelsText}
          onChange={(e) => onChange({ modelsText: e.target.value })}
          rows={8}
          placeholder={'每行一个模型 ID，可用 “|” 指定显示名\nqwen3.7-plus | Qwen 3.7 Plus'}
          className={`${inputClass} font-mono leading-relaxed resize-none`}
        />
        <p className={hintClass}>每行一个，第一个为默认模型。本应用依赖工具调用（function calling），请选择支持工具调用的模型。</p>
        {fetchMessage && <p className="mt-1 text-xs text-gray-700">{fetchMessage}</p>}
      </div>

      <ConnectionTester
        models={parseModelList(draft.modelsText)}
        currentModel={currentModel}
        onUseModel={onUseModel}
        buildRequest={async () => {
          const urlError = validateBaseURL(draft.baseURL)
          if (urlError) throw new Error(urlError)
          const apiKey = await encryptIfTyped(draft.apiKeyInput, draft.savedApiKey)
          if (!apiKey) throw new Error('请先填写 API Key')
          return { provider: draft.id, apiKey, baseURL: draft.baseURL.trim(), thinkingStyle: draft.thinkingStyle }
        }}
      />
    </div>
  )
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const {
    provider,
    model: currentModel,
    selectModel,
    serverProviders,
    customProviders,
    providerConfigs,
    setProviderConfig,
    clearProviderApiKey,
    saveCustomProvider,
    removeCustomProvider,
    thinkingCollapseMode, setThinkingCollapseMode,
    toolCallCollapseMode, setToolCallCollapseMode,
    maxSqlExecutions, setMaxSqlExecutions,
  } = useSettings()

  const [activeTab, setActiveTab] = useState(provider)
  const [section, setSection] = useState<SettingsSection>('models')
  const selectProviderTab = (id: string) => {
    setActiveTab(id)
    setSection('models')
  }
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveErrorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (saveError) saveErrorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [saveError])
  const [serverDrafts, setServerDrafts] = useState<Record<string, ServerDraft>>({})
  const [customDrafts, setCustomDrafts] = useState<CustomDraft[]>([])

  const [localThinkingCollapse, setLocalThinkingCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localToolCallCollapse, setLocalToolCallCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localMaxSqlExecutions, setLocalMaxSqlExecutions] = useState(20)

  useEffect(() => {
    if (open) {
      selectProviderTab(provider)
      setSaving(false)
      setSaveError('')
      setLocalThinkingCollapse(thinkingCollapseMode)
      setLocalToolCallCollapse(toolCallCollapseMode)
      setLocalMaxSqlExecutions(maxSqlExecutions)

      const drafts: Record<string, ServerDraft> = {}
      for (const p of serverProviders) {
        const cfg = providerConfigs[p.id]
        drafts[p.id] = { apiKeyInput: '', baseURLInput: cfg?.baseURL ?? '', hasSavedKey: !!cfg?.apiKey }
      }
      setServerDrafts(drafts)
      setCustomDrafts(customProviders.map(toCustomDraft))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, saving, onClose])

  if (!open) return null

  const activeServer = serverProviders.find((p) => p.id === activeTab)
  const activeCustom = customDrafts.find((d) => d.id === activeTab)

  const updateServerDraft = (providerId: string, partial: Partial<ServerDraft>) => {
    setServerDrafts((prev) => ({ ...prev, [providerId]: { ...(prev[providerId] ?? EMPTY_SERVER_DRAFT), ...partial } }))
  }

  const updateCustomDraft = (providerId: string, partial: Partial<CustomDraft>) => {
    setCustomDrafts((prev) => prev.map((d) => (d.id === providerId ? { ...d, ...partial } : d)))
  }

  const addFromTemplate = (template: ProviderTemplate) => {
    const draft: CustomDraft = {
      id: createCustomProviderId(),
      name: template.key === 'blank' ? '' : template.name,
      baseURL: template.baseURL,
      apiKeyInput: '',
      savedApiKey: '',
      modelsText: formatModelList(template.models),
      thinkingStyle: template.thinkingStyle,
    }
    setCustomDrafts((prev) => [...prev, draft])
    setActiveTab(draft.id)
    setSaveError('')
  }

  const removeDraft = (providerId: string) => {
    setCustomDrafts((prev) => prev.filter((d) => d.id !== providerId))
    setActiveTab(serverProviders[0]?.id ?? ADD_TAB)
  }

  /** Persist every tab of the dialog. Resolves to an error message, or null on success. */
  const persistAll = async (): Promise<string | null> => {
    setSaving(true)
    setSaveError('')
    try {
      for (const draft of customDrafts) {
        const error = validateCustomDraft(draft)
        if (error) {
          selectProviderTab(draft.id)
          return `${draft.name.trim() || '新服务'}：${error}`
        }
      }

      for (const p of serverProviders) {
        const local = serverDrafts[p.id]
        if (!local) continue
        const patch: Partial<ProviderConfig> = {}
        const trimmedKey = local.apiKeyInput.trim()
        if (trimmedKey) {
          const { encrypted } = await encryptPasswordFn({ data: { password: trimmedKey } })
          patch.apiKey = encrypted
        }
        patch.baseURL = local.baseURLInput.trim()
        setProviderConfig(p.id, patch)
      }

      const keptIds = new Set(customDrafts.map((d) => d.id))
      for (const p of customProviders) {
        if (!keptIds.has(p.id)) removeCustomProvider(p.id)
      }
      for (const draft of customDrafts) {
        const typedKey = draft.apiKeyInput.trim()
        const apiKey = typedKey ? (await encryptPasswordFn({ data: { password: typedKey } })).encrypted : draft.savedApiKey
        saveCustomProvider({
          id: draft.id,
          name: draft.name.trim(),
          baseURL: draft.baseURL.trim().replace(/\/+$/, ''),
          apiKey,
          models: parseModelList(draft.modelsText),
          thinkingStyle: draft.thinkingStyle,
        })
      }

      setThinkingCollapseMode(localThinkingCollapse)
      setToolCallCollapseMode(localToolCallCollapse)
      setMaxSqlExecutions(localMaxSqlExecutions)
      return null
    } catch (err) {
      console.error('[ApiKeyDialog] Save failed:', err)
      return err instanceof Error ? err.message : '保存失败，请重试'
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const error = await persistAll()
    if (error) setSaveError(error)
    else onClose()
  }

  /** Save, then make this provider + model the chat's current selection and close. */
  const handleUseModel = async (providerId: string, modelId: string): Promise<string | null> => {
    const error = await persistAll()
    if (error) {
      // Validation may have switched to another tab, unmounting the tester; report it dialog-wide too.
      setSaveError(error)
      return error
    }
    selectModel(providerId, modelId)
    onClose()
    return null
  }

  const handleClearServerKey = (providerId: string) => {
    clearProviderApiKey(providerId)
    updateServerDraft(providerId, { hasSavedKey: false, apiKeyInput: '' })
  }

  const navItemClass = (selected: boolean, indent = false) => `flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-lg py-2 text-sm transition-colors sm:w-full ${
    indent ? 'px-3 sm:pl-9' : 'px-3'
  } ${selected ? 'bg-white font-medium text-primary shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`

  const providerNavItems = [
    ...serverProviders.map((p) => ({ id: p.id, name: p.name, configured: p.hasEnvKey || !!serverDrafts[p.id]?.hasSavedKey })),
    ...customDrafts.map((d) => ({ id: d.id, name: d.name.trim() || '新服务', configured: !!d.savedApiKey || !!d.apiKeyInput.trim() })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="flex h-[min(720px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="settings-dialog-title" className="text-lg font-bold text-gray-900">设置</h2>
          <button onClick={onClose} aria-label="关闭设置" className="rounded-lg p-1.5 transition-colors hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Section navigation: a column on wide screens, a scrolling strip on phones */}
          <nav aria-label="设置分类" className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 p-2 sm:w-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3">
            <div className="hidden items-center gap-2 px-3 py-2 text-sm font-medium text-gray-900 sm:flex">
              <Cpu className="h-4 w-4 text-gray-500" />
              模型服务
            </div>
            {providerNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectProviderTab(item.id)}
                aria-current={section === 'models' && activeTab === item.id ? 'page' : undefined}
                className={navItemClass(section === 'models' && activeTab === item.id, true)}
              >
                <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
                <span
                  title={item.configured ? '已配置 API Key' : '未配置 API Key'}
                  aria-label={item.configured ? '已配置 API Key' : '未配置 API Key'}
                  className={`h-2 w-2 shrink-0 rounded-full ${item.configured ? 'bg-green-500' : 'border border-gray-400'}`}
                />
              </button>
            ))}
            <button
              onClick={() => selectProviderTab(ADD_TAB)}
              aria-current={section === 'models' && activeTab === ADD_TAB ? 'page' : undefined}
              className={`${navItemClass(section === 'models' && activeTab === ADD_TAB, true)} ${section === 'models' && activeTab === ADD_TAB ? '' : '!text-primary'}`}
            >
              <Plus className="h-4 w-4" />
              添加服务
            </button>

            <div className="my-2 hidden border-t border-gray-200 sm:block" />

            <button onClick={() => setSection('display')} aria-current={section === 'display' ? 'page' : undefined} className={navItemClass(section === 'display')}>
              <PanelsTopLeft className="h-4 w-4" />
              显示
            </button>
            <button onClick={() => setSection('sql')} aria-current={section === 'sql' ? 'page' : undefined} className={navItemClass(section === 'sql')}>
              <ShieldCheck className="h-4 w-4" />
              SQL 安全
            </button>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {section === 'models' && activeServer && (
              <ServerProviderForm
                provider={activeServer}
                key={activeServer.id}
                draft={serverDrafts[activeServer.id] ?? EMPTY_SERVER_DRAFT}
                savedApiKey={providerConfigs[activeServer.id]?.apiKey}
                currentModel={provider === activeServer.id ? currentModel : undefined}
                onUseModel={(modelId) => handleUseModel(activeServer.id, modelId)}
                onChange={(partial) => updateServerDraft(activeServer.id, partial)}
                onClearKey={() => handleClearServerKey(activeServer.id)}
              />
            )}

            {section === 'models' && activeCustom && (
              <CustomProviderForm
                key={activeCustom.id}
                draft={activeCustom}
                currentModel={provider === activeCustom.id ? currentModel : undefined}
                onUseModel={(modelId) => handleUseModel(activeCustom.id, modelId)}
                onChange={(partial) => updateCustomDraft(activeCustom.id, partial)}
                onRemove={() => removeDraft(activeCustom.id)}
              />
            )}

            {section === 'models' && !activeServer && !activeCustom && (
              <div className="space-y-4">
                <SectionHeader title="添加模型服务" description="添加任意兼容 OpenAI Chat Completions 接口的服务。选择模板可预填地址和参数。" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PROVIDER_TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => addFromTemplate(t)}
                      className="rounded-xl border border-gray-200 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      <div className="font-medium text-gray-800">{t.name}</div>
                      <div className="truncate font-mono text-xs text-gray-500">{t.baseURL || '手动填写地址'}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {section === 'display' && (
              <div className="space-y-5">
                <SectionHeader title="默认折叠状态" description="控制聊天中对应模块的初始展开/折叠状态。" />
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-700">思考过程</span>
                    <CollapseToggle value={localThinkingCollapse} onChange={setLocalThinkingCollapse} label="思考过程默认状态" />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-700">工具调用</span>
                    <CollapseToggle value={localToolCallCollapse} onChange={setLocalToolCallCollapse} label="工具调用默认状态" />
                  </div>
                </div>
              </div>
            )}

            {section === 'sql' && (
              <div className="space-y-5">
                <SectionHeader title="SQL 执行限制" description="每个会话中最多允许执行的 SQL 次数，防止 AI 过度查询。" />
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <ShieldCheck className="mt-px h-4 w-4 shrink-0" />
                  <p>请使用 MySQL 只读账号连接生产库。默认仅允许查询；写入须由管理员在服务器为指定的非生产数据库显式开启。</p>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                  <label htmlFor="max-sql-executions" className="text-sm text-gray-700">最大执行次数</label>
                  <input
                    id="max-sql-executions"
                    type="number"
                    min={1}
                    max={100}
                    value={localMaxSqlExecutions}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10)
                      if (!isNaN(v)) {
                        setLocalMaxSqlExecutions(Math.max(1, Math.min(100, v)))
                      }
                    }}
                    className="w-20 rounded-lg border border-gray-300 px-3 py-1.5 text-center text-sm tabular-nums outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-white px-6 py-3">
          {saveError && <p ref={saveErrorRef} role="alert" className="mr-auto min-w-0 text-xs text-red-600">{saveError}</p>}
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            关闭
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
