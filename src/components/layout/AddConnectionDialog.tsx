import { useState, useEffect, useRef, useId } from 'react'
import { X, Database, Loader2, Eye, EyeOff } from 'lucide-react'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { MAX_DATABASE_CA_BYTES, requiresDatabaseTls, validateDatabaseCa } from '@/lib/database-tls'
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

interface ConnectionForm {
  name: string
  host: string
  port: number
  user: string
  password: string
  database: string
  env: DbEnv
  sslEnabled: boolean
  sslCa: string
}

const emptyForm = (): ConnectionForm => ({
  name: '', host: 'localhost', port: 3306, user: 'root', password: '', database: '', env: 'dev',
  sslEnabled: false, sslCa: '',
})

export function AddConnectionDialog({ open, onClose }: AddConnectionDialogProps) {
  const { addConnection, updateConnection, editingConnection, setEditingConnection } = useDatabaseStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const caFileRef = useRef<HTMLInputElement>(null)
  const dialogTitleId = useId()
  const tlsInputId = useId()
  const caInputId = useId()
  const caHelpId = useId()
  const isEdit = editingConnection !== null
  const [form, setForm] = useState<ConnectionForm>(emptyForm)
  const tlsRequired = requiresDatabaseTls(form.host)
  const tlsEnabled = tlsRequired || form.sslEnabled

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
        sslEnabled: editingConnection.ssl !== undefined,
        sslCa: editingConnection.ssl?.ca ?? '',
      })
    } else {
      setForm(emptyForm())
    }
    setError('')
  }, [editingConnection])

  useEffect(() => {
    if (open) {
      setError('')
      setShowPassword(false)
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const ca = form.sslCa.trim()
    if (tlsEnabled && ca) {
      const caError = validateDatabaseCa(ca)
      if (caError) {
        setError(caError)
        return
      }
    }
    setLoading(true)
    try {
      const { sslEnabled: _sslEnabled, sslCa: _sslCa, ...connection } = form
      const data = {
        ...connection,
        host: connection.host.trim(),
        ssl: tlsEnabled ? { ca: ca || undefined } : undefined,
      }
      if (isEdit) {
        await updateConnection(editingConnection!.id, data)
        setEditingConnection(null)
      } else {
        await addConnection(data)
      }
      onClose()
      if (!isEdit) {
        setForm(emptyForm())
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败'
      setError(/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|fetch failed/i.test(message)
        ? '无法连接应用服务器，请检查网络连接，或稍后重试。'
        : message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setEditingConnection(null)
    onClose()
  }

  const handleCaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_DATABASE_CA_BYTES) {
      setError('CA 证书文件不能超过 64 KiB。')
      return
    }
    try {
      const ca = await file.text()
      const caError = validateDatabaseCa(ca)
      if (caError) {
        setError(caError)
        return
      }
      setForm(current => ({ ...current, sslEnabled: true, sslCa: ca.trim() }))
    } catch {
      setError('无法读取 CA 证书文件，请重新选择。')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[calc(100dvh-2rem)] flex flex-col">
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            <h2 id={dialogTitleId} className="font-semibold text-gray-900">
              {isEdit ? '编辑数据库连接' : '添加数据库连接'}
            </h2>
          </div>
          <button onClick={handleClose} aria-label="关闭数据库连接窗口" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3 min-h-0 overflow-y-auto">
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

          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2.5">
            <label htmlFor={tlsInputId} className="flex items-center gap-2 text-xs font-medium text-gray-700">
              <input
                id={tlsInputId}
                type="checkbox"
                checked={tlsEnabled}
                disabled={tlsRequired}
                onChange={event => setForm({ ...form, sslEnabled: event.target.checked })}
                className="accent-primary"
              />
              安全连接（SSL/TLS）
              {tlsRequired && <span className="ml-auto text-[10px] font-normal text-primary">Aiven 已自动启用</span>}
            </label>
            {tlsEnabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={caInputId} className="text-xs font-medium text-gray-600">
                    CA 证书（可选）
                  </label>
                  <button type="button" onClick={() => caFileRef.current?.click()} className="text-xs font-medium text-primary hover:underline">
                    导入证书文件
                  </button>
                  <input ref={caFileRef} type="file" accept=".pem,.crt,.cer" aria-label="导入 CA 证书文件" onChange={handleCaFile} className="hidden" />
                </div>
                <textarea
                  id={caInputId}
                  value={form.sslCa}
                  onChange={event => setForm({ ...form, sslCa: event.target.value })}
                  rows={3}
                  spellCheck={false}
                  aria-describedby={caHelpId}
                  placeholder={'-----BEGIN CERTIFICATE-----\n粘贴 PEM 格式的 CA 证书\n-----END CERTIFICATE-----'}
                  className="w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-gray-400"
                />
                <p id={caHelpId} className="text-[10px] leading-relaxed text-gray-400">
                  {tlsRequired ? '服务端已统一配置 CA 时可留空，也可从 Aiven 服务 Overview 下载后导入。' : '使用自签名 CA 的数据库需导入证书；使用受信任证书的数据库可留空。'}
                  连接时将校验证书和主机名。
                </p>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
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
  const inputId = useId()
  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
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
  const inputId = useId()

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.type = showPassword ? 'text' : 'password'
    }
  }, [showPassword])

  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full px-3 py-2 pr-9 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:border-gray-400 focus:bg-white outline-none transition-colors"
        />
        <button
          type="button"
          onClick={onTogglePassword}
          aria-label={showPassword ? '隐藏数据库密码' : '显示数据库密码'}
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
