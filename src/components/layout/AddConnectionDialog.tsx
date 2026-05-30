import { useState } from 'react'
import { X, Database, Loader2 } from 'lucide-react'
import { useDatabaseStore } from '@/hooks/useDatabase'

interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
}

export function AddConnectionDialog({ open, onClose }: AddConnectionDialogProps) {
  const { addConnection } = useDatabaseStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: '',
  })

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await addConnection(form)
      onClose()
      setForm({ name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">添加数据库连接</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <Field label="连接名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Database" />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="主机" value={form.host} onChange={(v) => setForm({ ...form, host: v })} />
            </div>
            <Field label="端口" value={String(form.port)} onChange={(v) => setForm({ ...form, port: Number(v) || 3306 })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="用户名" value={form.user} onChange={(v) => setForm({ ...form, user: v })} />
            <Field label="密码" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
          </div>
          <Field label="数据库名" value={form.database} onChange={(v) => setForm({ ...form, database: v })} placeholder="my_database" />

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading || !form.name || !form.database}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '连接中...' : '添加连接'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none"
      />
    </div>
  )
}
