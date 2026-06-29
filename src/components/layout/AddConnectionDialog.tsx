import { useState, useEffect, useRef } from 'react'
import { X, Database, Loader2, Eye, EyeOff } from 'lucide-react'
import { useDatabaseStore } from '@/hooks/useDatabase'
import type { DbEnv } from '@/lib/types'

const envOptions: { value: DbEnv; label: string; description: string }[] = [
  { value: 'dev', label: '开发环境 DEV', description: '日常开发和调试使用' },
  { value: 'test', label: '测试环境 PRE', description: 'QA 测试和集成验证' },
  { value: 'staging', label: '预发布环境 UAT', description: '上线前最终验证' },
  { value: 'prod', label: '生产环境 PROD', description: '正式线上环境，谨慎操作' },
]

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
    env: 'dev' as DbEnv,
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
        env: editingConnection.env || 'dev',
      })
    } else {
      setForm({ name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '', env: 'dev' })
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
        setForm({ name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '', env: 'dev' })
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
            <Database className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-gray-900">
              {isEdit ? '编辑数据库连接' : '添加数据库连接'}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <Field label="连接名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Database" required />
          {/* Environment selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">连接环境 <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-4 gap-2">
              {envOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, env: opt.value })}
                  className={cnEnvButton(form.env === opt.value, opt.value)}
                  title={opt.description}
                >
                  {opt.label.split(' ')[1]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {envOptions.find(o => o.value === form.env)?.description}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="主机" value={form.host} onChange={(v) => setForm({ ...form, host: v })} required />
            </div>
            <Field label="端口" value={String(form.port)} onChange={(v) => setForm({ ...form, port: Number(v) || 3306 })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="用户名" value={form.user} onChange={(v) => setForm({ ...form, user: v })} required />
            <PasswordField label="密码" value={form.password} onChange={(v) => setForm({ ...form, password: v })} showPassword={showPassword} onTogglePassword={() => setShowPassword(!showPassword)} placeholder={isEdit ? '留空则不修改密码' : ''} />
          </div>
          <Field label="数据库名" value={form.database} onChange={(v) => setForm({ ...form, database: v })} placeholder="my_database" required />

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
              disabled={loading || !form.name || !form.host || !form.database || !form.user || !form.env || (!isEdit && !form.password)}
              className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
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
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  showPassword: boolean
  onTogglePassword: () => void
  required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.type = showPassword ? 'text' : 'password'
    }
  }, [showPassword])

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
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

function cnEnvButton(selected: boolean, env: DbEnv): string {
  const colorMap: Record<DbEnv, { active: string; inactive: string }> = {
    dev: {
      active: 'bg-green-50 border-green-400 text-green-700 ring-1 ring-green-400/30',
      inactive: 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-green-50/40 hover:border-green-300 hover:text-primary',
    },
    test: {
      active: 'bg-blue-50 border-blue-400 text-blue-700 ring-1 ring-blue-400/30',
      inactive: 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-blue-50/40 hover:border-blue-300 hover:text-blue-600',
    },
    staging: {
      active: 'bg-yellow-50 border-yellow-400 text-yellow-700 ring-1 ring-yellow-400/30',
      inactive: 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-yellow-50/40 hover:border-yellow-300 hover:text-yellow-600',
    },
    prod: {
      active: 'bg-red-50 border-red-400 text-red-700 ring-1 ring-red-400/30',
      inactive: 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-red-50/40 hover:border-red-300 hover:text-red-600',
    },
  }
  const base = 'px-2 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer'
  const colors = selected ? colorMap[env].active : colorMap[env].inactive
  return `${base} ${colors}`
}
