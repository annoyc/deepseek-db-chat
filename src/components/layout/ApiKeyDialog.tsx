import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Server } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { getEnvApiKeyStatus } from '@/server/functions/settings'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
}

function readApiKeyFromStorage(): string {
  try {
    const raw = window.localStorage.getItem('deepseek-api-key')
    return raw ? JSON.parse(raw) : ''
  } catch {
    return ''
  }
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const { setApiKey, clearApiKey } = useSettings()
  const [inputValue, setInputValue] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [envStatus, setEnvStatus] = useState<{ hasEnvKey: boolean; maskedKey: string }>({
    hasEnvKey: false,
    maskedKey: '',
  })

  useEffect(() => {
    if (open) {
      const key = readApiKeyFromStorage()
      setInputValue(key)
      setSavedKey(key)
      getEnvApiKeyStatus().then(setEnvStatus).catch(() => {})
    }
  }, [open])

  if (!open) return null

  const handleSave = () => {
    const trimmed = inputValue.trim()
    setApiKey(trimmed)
    setSavedKey(trimmed)
    onClose()
  }

  const handleClear = () => {
    clearApiKey()
    setInputValue('')
    setSavedKey('')
  }

  const hasLocalKey = !!savedKey
  const hasAnyKey = hasLocalKey || envStatus.hasEnvKey

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 pb-2">
          <h2 className="text-lg font-bold text-gray-900">API Key 设置</h2>
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
                  {hasLocalKey
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

          {hasLocalKey && (
            <p className="text-xs text-green-600">
              已保存自定义 API Key 到浏览器本地
            </p>
          )}

          {!hasAnyKey && (
            <p className="text-xs text-amber-600">
              未检测到任何 API Key，请输入后保存，或在 .env 文件中配置 DEEPSEEK_API_KEY
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            {hasLocalKey && (
              <button
                onClick={handleClear}
                className="px-6 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors mr-auto"
              >
                清除
              </button>
            )}
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              关闭
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 text-sm font-medium text-white bg-green-700 rounded-xl hover:bg-green-800 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
