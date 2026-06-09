import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Server, Lock, Loader2, Globe } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import type { ProviderConfig } from '@/hooks/useSettings'
import { getEnvApiKeyStatus } from '@/server/functions/settings'
import { encryptPasswordFn } from '@/server/functions/crypto'
import { PROVIDERS } from '@/lib/constants'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
}

type EnvStatusMap = Record<string, { hasEnvKey: boolean; maskedKey: string }>

interface LocalProviderConfig {
  apiKeyInput: string
  baseURLInput: string
  hasSavedKey: boolean
}

type LocalProviderConfigs = Record<string, LocalProviderConfig>

const EMPTY_LOCAL: LocalProviderConfig = { apiKeyInput: '', baseURLInput: '', hasSavedKey: false }

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const {
    provider,
    providerConfigs,
    setProviderConfig,
    clearProviderApiKey,
    thinkingCollapseMode, setThinkingCollapseMode,
    toolCallCollapseMode, setToolCallCollapseMode,
    maxSqlExecutions, setMaxSqlExecutions,
  } = useSettings()

  const [activeTab, setActiveTab] = useState(provider)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [envStatus, setEnvStatus] = useState<EnvStatusMap>({})
  const [localConfigs, setLocalConfigs] = useState<LocalProviderConfigs>({})

  const [localThinkingCollapse, setLocalThinkingCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localToolCallCollapse, setLocalToolCallCollapse] = useState<'expanded' | 'collapsed'>('collapsed')
  const [localMaxSqlExecutions, setLocalMaxSqlExecutions] = useState(20)

  useEffect(() => {
    if (open) {
      setActiveTab(provider)
      setShowKey({})
      setSaving(false)
      setLocalThinkingCollapse(thinkingCollapseMode)
      setLocalToolCallCollapse(toolCallCollapseMode)
      setLocalMaxSqlExecutions(maxSqlExecutions)

      const initLocal: LocalProviderConfigs = {}
      for (const p of PROVIDERS) {
        const cfg = providerConfigs[p.id]
        initLocal[p.id] = {
          apiKeyInput: '',
          baseURLInput: cfg?.baseURL ?? '',
          hasSavedKey: !!cfg?.apiKey,
        }
      }
      setLocalConfigs(initLocal)

      for (const p of PROVIDERS) {
        getEnvApiKeyStatus({ data: { provider: p.id } })
          .then((status) => setEnvStatus((prev) => ({ ...prev, [p.id]: status })))
          .catch(() => {})
      }
    }
  }, [open])

  if (!open) return null

  const currentLocal = localConfigs[activeTab] ?? EMPTY_LOCAL
  const currentEnv = envStatus[activeTab] ?? { hasEnvKey: false, maskedKey: '' }
  const currentProviderDef = PROVIDERS.find((p) => p.id === activeTab)
  const hasAnyKey = currentLocal.hasSavedKey || currentEnv.hasEnvKey

  const updateLocalConfig = (providerId: string, partial: Partial<LocalProviderConfig>) => {
    setLocalConfigs((prev) => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? EMPTY_LOCAL), ...partial },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const p of PROVIDERS) {
        const local = localConfigs[p.id]
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

      setThinkingCollapseMode(localThinkingCollapse)
      setToolCallCollapseMode(localToolCallCollapse)
      setMaxSqlExecutions(localMaxSqlExecutions)

      onClose()
    } catch (err) {
      console.error('[ApiKeyDialog] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleClearKey = (providerId: string) => {
    clearProviderApiKey(providerId)
    updateLocalConfig(providerId, { hasSavedKey: false, apiKeyInput: '' })
  }

  const envKeyName = activeTab === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'BAILIAN_API_KEY'

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
            <div className="text-sm font-medium text-gray-700">Provider 配置</div>
            <div className="flex border-b border-gray-200">
              {PROVIDERS.map((p) => {
                const cfg = providerConfigs[p.id]
                const env = envStatus[p.id]
                const configured = !!(cfg?.apiKey) || !!(env?.hasEnvKey)
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveTab(p.id as any)}
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === p.id
                        ? 'text-green-700 border-b-2 border-green-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {p.name}
                    <span className={`w-1.5 h-1.5 rounded-full ${configured ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Env status hint */}
          {currentEnv.hasEnvKey && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <Server className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700">
                <p className="font-medium">已通过环境变量配置 API Key</p>
                <p className="mt-0.5 font-mono text-blue-600">{currentEnv.maskedKey}</p>
                <p className="mt-1 text-blue-500">
                  {currentLocal.hasSavedKey
                    ? '当前使用浏览器本地保存的 Key（优先级更高）'
                    : '如需覆盖，可在下方输入新的 Key'}
                </p>
              </div>
            </div>
          )}

          {/* API Key input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {currentEnv.hasEnvKey ? `自定义 API Key（可选）` : `${currentProviderDef?.name ?? ''} API Key`}
            </label>
            <div className="relative">
              <input
                key={`${activeTab}-${showKey[activeTab] ? 'text' : 'password'}`}
                type={showKey[activeTab] ? 'text' : 'password'}
                value={currentLocal.apiKeyInput}
                onChange={(e) => updateLocalConfig(activeTab, { apiKeyInput: e.target.value })}
                placeholder="sk-..."
                className="w-full px-4 py-3 pr-10 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => ({ ...prev, [activeTab]: !prev[activeTab] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                {showKey[activeTab] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {currentLocal.hasSavedKey && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <Lock className="w-3.5 h-3.5" />
                <span>已加密保存 API Key（AES-256-GCM）</span>
              </div>
              <button
                onClick={() => handleClearKey(activeTab)}
                className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
              >
                清除
              </button>
            </div>
          )}

          {!hasAnyKey && (
            <p className="text-xs text-amber-600">
              未检测到 {currentProviderDef?.name} 的 API Key，请输入后保存，或在 .env 中配置 {envKeyName}
            </p>
          )}

          {/* Base URL input */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
              <Globe className="w-3.5 h-3.5" />
              自定义 Base URL（可选）
            </label>
            <input
              type="text"
              value={currentLocal.baseURLInput}
              onChange={(e) => updateLocalConfig(activeTab, { baseURLInput: e.target.value })}
              placeholder={
                activeTab === 'deepseek'
                  ? 'https://api.deepseek.com'
                  : 'https://dashscope.aliyuncs.com/compatible-mode/v1'
              }
              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              留空则使用默认地址，自建代理或私有部署时填写
            </p>
          </div>

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
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setLocalThinkingCollapse('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localThinkingCollapse === 'collapsed'
                      ? 'bg-white text-green-700 shadow-sm'
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
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setLocalToolCallCollapse('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    localToolCallCollapse === 'collapsed'
                      ? 'bg-white text-green-700 shadow-sm'
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
                className="w-20 px-3 py-1.5 text-sm text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all tabular-nums"
              />
            </div>
          </div>

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
              className="px-6 py-2.5 text-sm font-medium text-white bg-green-700 rounded-xl hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
