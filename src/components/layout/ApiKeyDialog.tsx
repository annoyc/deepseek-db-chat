import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Server, Lock, Loader2, Globe, Plus, Trash2, RefreshCw, Activity, CircleCheck, CircleX, CircleMinus } from 'lucide-react'
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

const inputClass = 'w-full px-4 py-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all'

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
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-xs text-primary">
        <Lock className="w-3.5 h-3.5" />
        <span>已加密保存 API Key（AES-256-GCM）</span>
      </div>
      <button
        onClick={onClear}
        className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
      >
        清除
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
function ConnectionTester({ models, buildRequest }: {
  models: ProviderModel[]
  /** Throws an Error whose message explains what is missing. */
  buildRequest: () => Promise<ConnectionRequest>
}) {
  const [selected, setSelected] = useState('')
  const [running, setRunning] = useState(false)
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
      <p className="text-xs text-gray-400">使用当前填写（未保存）的配置，依次检查流式工具调用、JSON 输出与思考参数，会产生少量 token 消耗。</p>
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
          <li className={`pt-0.5 text-xs font-medium ${result.ok ? 'text-green-700' : 'text-amber-700'}`}>
            {result.ok ? `模型 ${result.model} 可用` : '存在未通过的检查项，对话可能失败'}
          </li>
        </ul>
      )}
    </div>
  )
}

function ServerProviderForm({ provider, draft, savedApiKey, onChange, onClearKey }: {
  provider: ServerProvider
  draft: ServerDraft
  savedApiKey?: string
  onChange: (partial: Partial<ServerDraft>) => void
  onClearKey: () => void
}) {
  const hasAnyKey = draft.hasSavedKey || provider.hasEnvKey
  return (
    <div className="space-y-4">
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {provider.hasEnvKey ? '自定义 API Key（可选）' : `${provider.name} API Key`}
        </label>
        <ApiKeyInput value={draft.apiKeyInput} onChange={(v) => onChange({ apiKeyInput: v })} />
      </div>

      {draft.hasSavedKey && <SavedKeyNotice onClear={onClearKey} />}

      {!hasAnyKey && (
        <p className="text-xs text-amber-600">
          未检测到 {provider.name} 的 API Key，请输入后保存，或联系管理员在服务器配置
        </p>
      )}

      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
          <Globe className="w-3.5 h-3.5" />
          自定义 Base URL（可选）
        </label>
        <input
          type="text"
          value={draft.baseURLInput}
          onChange={(e) => onChange({ baseURLInput: e.target.value })}
          placeholder={provider.defaultBaseURL ?? '服务器配置的地址'}
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-gray-400 mt-1">
          留空则使用服务器配置的地址。填写自定义地址时，需要同时提供自有 API Key。
        </p>
      </div>

      <ConnectionTester
        models={provider.models}
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

function CustomProviderForm({ draft, onChange, onRemove }: {
  draft: CustomDraft
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
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">服务名称</label>
        <input type="text" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="例如：阿里云百炼" maxLength={50} className={inputClass} />
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
          <Globe className="w-3.5 h-3.5" />
          Base URL
        </label>
        <input
          type="text"
          value={draft.baseURL}
          onChange={(e) => onChange({ baseURL: e.target.value })}
          placeholder="https://example.com/v1"
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-gray-400 mt-1">OpenAI 兼容地址，请求将发送到 {'{Base URL}'}/chat/completions</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
        <ApiKeyInput
          value={draft.apiKeyInput}
          onChange={(v) => onChange({ apiKeyInput: v })}
          placeholder={draft.savedApiKey ? '已保存，留空则保持不变' : 'sk-...'}
        />
        <p className="text-xs text-gray-400 mt-1">自定义服务只使用你自己的 Key，服务器密钥不会用于此服务。</p>
      </div>

      {draft.savedApiKey && <SavedKeyNotice onClear={() => onChange({ savedApiKey: '' })} />}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">思考参数</label>
        <select
          value={draft.thinkingStyle}
          onChange={(e) => onChange({ thinkingStyle: e.target.value as ThinkingStyle })}
          className={inputClass}
        >
          {(Object.keys(THINKING_STYLE_LABELS) as ThinkingStyle[]).map((style) => (
            <option key={style} value={style}>{THINKING_STYLE_LABELS[style].label}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">{THINKING_STYLE_LABELS[draft.thinkingStyle].hint}</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
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
          rows={5}
          placeholder={'每行一个模型 ID，可用 “|” 指定显示名\nqwen3.7-plus | Qwen 3.7 Plus'}
          className={`${inputClass} font-mono resize-y`}
        />
        <p className="text-xs text-gray-400 mt-1">第一个模型为默认模型。本应用依赖工具调用（function calling），请选择支持工具调用的模型。</p>
        {fetchMessage && <p className="text-xs text-gray-600 mt-1">{fetchMessage}</p>}
      </div>

      <ConnectionTester
        models={parseModelList(draft.modelsText)}
        buildRequest={async () => {
          const urlError = validateBaseURL(draft.baseURL)
          if (urlError) throw new Error(urlError)
          const apiKey = await encryptIfTyped(draft.apiKeyInput, draft.savedApiKey)
          if (!apiKey) throw new Error('请先填写 API Key')
          return { provider: draft.id, apiKey, baseURL: draft.baseURL.trim(), thinkingStyle: draft.thinkingStyle }
        }}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除此服务
        </button>
      </div>
    </div>
  )
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const {
    provider,
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
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [serverDrafts, setServerDrafts] = useState<Record<string, ServerDraft>>({})
  const [customDrafts, setCustomDrafts] = useState<CustomDraft[]>([])

  const [localThinkingCollapse, setLocalThinkingCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localToolCallCollapse, setLocalToolCallCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localMaxSqlExecutions, setLocalMaxSqlExecutions] = useState(20)

  useEffect(() => {
    if (open) {
      setActiveTab(provider)
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

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      for (const draft of customDrafts) {
        const error = validateCustomDraft(draft)
        if (error) {
          setActiveTab(draft.id)
          setSaveError(`${draft.name.trim() || '新服务'}：${error}`)
          return
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

      onClose()
    } catch (err) {
      console.error('[ApiKeyDialog] Save failed:', err)
      setSaveError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handleClearServerKey = (providerId: string) => {
    clearProviderApiKey(providerId)
    updateServerDraft(providerId, { hasSavedKey: false, apiKeyInput: '' })
  }

  const tabClass = (selected: boolean) => `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
    selected ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700'
  }`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-2">
          <h2 className="text-lg font-bold text-gray-900">设置</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4 overflow-y-auto">
          {/* Provider Tabs */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">模型服务</div>
            <div className="flex overflow-x-auto border-b border-gray-200">
              {serverProviders.map((p) => {
                const configured = p.hasEnvKey || !!serverDrafts[p.id]?.hasSavedKey
                return (
                  <button key={p.id} onClick={() => setActiveTab(p.id)} className={tabClass(activeTab === p.id)}>
                    {p.name}
                    <span className={`w-1.5 h-1.5 rounded-full ${configured ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </button>
                )
              })}
              {customDrafts.map((d) => {
                const configured = !!d.savedApiKey || !!d.apiKeyInput.trim()
                return (
                  <button key={d.id} onClick={() => setActiveTab(d.id)} className={tabClass(activeTab === d.id)}>
                    {d.name.trim() || '新服务'}
                    <span className={`w-1.5 h-1.5 rounded-full ${configured ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </button>
                )
              })}
              <button onClick={() => setActiveTab(ADD_TAB)} className={tabClass(activeTab === ADD_TAB)} title="添加模型服务">
                <Plus className="w-4 h-4" />
                添加
              </button>
            </div>
          </div>

          {activeServer && (
            <ServerProviderForm
              provider={activeServer}
              key={activeServer.id}
              draft={serverDrafts[activeServer.id] ?? EMPTY_SERVER_DRAFT}
              savedApiKey={providerConfigs[activeServer.id]?.apiKey}
              onChange={(partial) => updateServerDraft(activeServer.id, partial)}
              onClearKey={() => handleClearServerKey(activeServer.id)}
            />
          )}

          {activeCustom && (
            <CustomProviderForm
              key={activeCustom.id}
              draft={activeCustom}
              onChange={(partial) => updateCustomDraft(activeCustom.id, partial)}
              onRemove={() => removeDraft(activeCustom.id)}
            />
          )}

          {!activeServer && !activeCustom && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">添加任意兼容 OpenAI Chat Completions 接口的服务。选择模板可预填地址和参数：</p>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDER_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => addFromTemplate(t)}
                    className="rounded-xl border border-gray-200 px-3 py-2.5 text-left text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <div className="font-medium text-gray-800">{t.name}</div>
                    <div className="truncate text-xs text-gray-400 font-mono">{t.baseURL || '手动填写地址'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 显示设置 */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="text-sm font-medium text-gray-700">默认折叠状态</div>
            <p className="text-xs text-gray-400 -mt-1">
              控制聊天中对应模块的初始展开/折叠状态
            </p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">思考过程</span>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setLocalThinkingCollapse('expanded')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localThinkingCollapse === 'expanded'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setLocalThinkingCollapse('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localThinkingCollapse === 'collapsed'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  折叠
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">工具调用</span>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setLocalToolCallCollapse('expanded')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localToolCallCollapse === 'expanded'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setLocalToolCallCollapse('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localToolCallCollapse === 'collapsed'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  折叠
                </button>
              </div>
            </div>
          </div>

          {/* SQL 执行限制 */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="text-sm font-medium text-gray-700">SQL 执行限制</div>
            <p className="text-xs text-amber-700">
              请使用 MySQL 只读账号连接生产库。默认仅允许查询；写入须由管理员在服务器为指定的非生产数据库显式开启。
            </p>
            <p className="text-xs text-gray-400 -mt-1">
              每个会话中最多允许执行的 SQL 次数，防止 AI 过度查询
            </p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">最大执行次数</span>
              <input
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
                className="w-20 px-3 py-1.5 text-sm text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all tabular-nums"
              />
            </div>
          </div>

          {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              关闭
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
