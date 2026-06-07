import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Server, Lock, Loader2 } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { getEnvApiKeyStatus } from '@/server/functions/settings'
import { encryptPasswordFn } from '@/server/functions/crypto'
import { db } from '@/lib/db'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
}

async function hasEncryptedKey(): Promise<boolean> {
  try {
    const record = await db.settings.get('deepseek-api-key')
    return record !== undefined && !!record.value
  } catch {
    return false
  }
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const { setApiKey, clearApiKey, thinkingCollapseMode, setThinkingCollapseMode, toolCallCollapseMode, setToolCallCollapseMode } = useSettings()
  const [inputValue, setInputValue] = useState('')
  const [hasSavedKey, setHasSavedKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [envStatus, setEnvStatus] = useState<{ hasEnvKey: boolean; maskedKey: string }>({
    hasEnvKey: false,
    maskedKey: '',
  })

  useEffect(() => {
    if (open) {
      setInputValue('')
      hasEncryptedKey().then(setHasSavedKey)
      setShowKey(false)
      getEnvApiKeyStatus().then(setEnvStatus).catch(() => {})
    }
  }, [open])

  if (!open) return null

  const handleSave = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const { encrypted } = await encryptPasswordFn({ data: { password: trimmed } })
      setApiKey(encrypted)
      setHasSavedKey(true)
      setInputValue('')
      onClose()
    } catch (err) {
      console.error('[ApiKeyDialog] Encrypt failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    clearApiKey()
    setHasSavedKey(false)
    setInputValue('')
  }

  const hasAnyKey = hasSavedKey || envStatus.hasEnvKey

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 pb-2">
          <h2 className="text-lg font-bold text-gray-900">设置</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">

          {envStatus.hasEnvKey && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <Server className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700">
                <p className="font-medium">已通过环境变量配置 API Key</p>
                <p className="mt-0.5 font-mono text-blue-600">{envStatus.maskedKey}</p>
                <p className="mt-1 text-blue-500">
                  {hasSavedKey
                    ? '当前使用浏览器本地保存的 Key（优先级更高）'
                    : '如需覆盖，可在下方输入新的 Key'}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {envStatus.hasEnvKey ? '自定义 API Key（可选）' : '请输入您的 DeepSeek API Key'}
            </label>
            <div className="relative">
              <input
                key={showKey ? 'text' : 'password'}
                type={showKey ? 'text' : 'password'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="sk-..."
                className="w-full px-4 py-3 pr-10 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {hasSavedKey && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <Lock className="w-3.5 h-3.5" />
                <span>已加密保存 API Key（AES-256-GCM），浏览器无法查看明文</span>
              </div>
              <button
                onClick={handleClear}
                className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
              >
                清除
              </button>
            </div>
          )}

          {!hasAnyKey && (
            <p className="text-xs text-amber-600">
              未检测到任何 API Key，请输入后保存，或在 .env 文件中配置 DEEPSEEK_API_KEY
            </p>
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
                  onClick={() => setThinkingCollapseMode('expanded')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    thinkingCollapseMode === 'expanded'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setThinkingCollapseMode('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    thinkingCollapseMode === 'collapsed'
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
                  onClick={() => setToolCallCollapseMode('expanded')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    toolCallCollapseMode === 'expanded'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  展开
                </button>
                <button
                  onClick={() => setToolCallCollapseMode('collapsed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    toolCallCollapseMode === 'collapsed'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  折叠
                </button>
              </div>
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
              disabled={saving || !inputValue.trim()}
              className="px-6 py-2.5 text-sm font-medium text-white bg-green-700 rounded-xl hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? '加密保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
