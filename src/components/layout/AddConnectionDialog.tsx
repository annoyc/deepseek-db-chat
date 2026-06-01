import { useState, useEffect, useRef } from 'react'
import { X, Database, Loader2, Eye, EyeOff } from 'lucide-react'
import { useDatabaseStore } from '@/hooks/useDatabase'

interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
}

export function AddConnectionDialog({ open, onClose }: AddConnectionDialogProps) {
  const { addConnection, updateConnection, editingConnection, setEditingConnection } = useDatabaseStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const isEdit = editingConnection !== null
  const [form, setForm] = useState({
    name: '',
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: '',
  })

  useEffect(() => {
    if (editingConnection) {
      setForm({
        name: editingConnection.name,
        host: editingConnection.host,
        port: editingConnection.port,
        user: editingConnection.user,
        password: '',
        database: editingConnection.database,
      })
    } else {
      setForm({ name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '' })
    }
  }, [editingConnection])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isEdit) {
        await updateConnection(editingConnection!.id, form)
        setEditingConnection(null)
      } else {
        await addConnection(form)
      }
      onClose()
      if (!isEdit) {
        setForm({ name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setEditingConnection(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-green-700" />
            <h2 className="font-semibold text-gray-900">
              {isEdit ? '编辑数据库连接' : '添加数据库连接'}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <Field label="连接名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Database" />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="主机" value={form.host} onChange={(v) => setForm({ ...form, host: v })} />
            </div>
            <Field label="端口" value={String(form.port)} onChange={(v) => setForm({ ...form, port: Number(v) || 3306 })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="用户名" value={form.user} onChange={(v) => setForm({ ...form, user: v })} />
            <PasswordField label="密码" value={form.password} onChange={(v) => setForm({ ...form, password: v })} showPassword={showPassword} onTogglePassword={() => setShowPassword(!showPassword)} placeholder={isEdit ? '留空则不修改密码' : ''} />
          </div>
          <Field label="数据库名" value={form.database} onChange={(v) => setForm({ ...form, database: v })} placeholder="my_database" />

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2.5 border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              关闭
            </button>
            <button
              type="submit"
              disabled={loading || !form.name || !form.database}
              className="px-5 py-2 text-sm font-medium text-white bg-green-700 rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  连接中...
                </span>
              ) : isEdit ? '保存修改' : '添加连接'}
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
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:border-gray-400 focus:bg-white outline-none transition-colors"
      />
    </div>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  onTogglePassword,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  showPassword: boolean
  onTogglePassword: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.type = showPassword ? 'text' : 'password'
    }
  }, [showPassword])

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-9 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:border-gray-400 focus:bg-white outline-none transition-colors"
        />
        <button
          type="button"
          onClick={onTogglePassword}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}