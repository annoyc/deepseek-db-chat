import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
}

export function ApiKeyDialog({ open, onClose }: ApiKeyDialogProps) {
  const { apiKey, setApiKey, clearApiKey } = useSettings()
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    if (open) {
      setInputValue(apiKey)
    }
  }, [open, apiKey])

  if (!open) return null

  const handleSave = () => {
    setApiKey(inputValue.trim())
    onClose()
  }

  const handleClear = () => {
    clearApiKey()
    setInputValue('')
    onClose()
  }

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
          <p className="text-sm text-gray-500">
            输入自定义 DeepSeek API Key。留空并保存将使用服务端默认配置。
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              DeepSeek API Key
            </label>
            <input
              type="password"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handleClear}
              className="px-6 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              清除
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
