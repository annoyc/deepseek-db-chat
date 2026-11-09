import type { GetBalanceOptions } from './balance'
import type { ListModelsOptions } from './list'
import type { InvokeParams, ModelOptions, ResolvedModelOptions } from './types'
import type { FIMParams } from '@/core/fim/types'
import { omitBy, toMerged } from '@/core/utils'
import { findProvider, getServerApiKey, getServerBaseURL, isCustomProviderId } from '@/core/provider'
import { getBalance } from './balance'
import { fim } from './fim'
import { invoke, invokeStream } from './invoke'
import { listModels } from './list'

export class DeepSeekModel {
  private readonly _config: ResolvedModelOptions

  constructor(options: ModelOptions) {
    this._config = resolveConfig(options)
    if (this._config.strict) {
      this.enableBeta()
    }
  }

  public get config(): ResolvedModelOptions {
    return this._config
  }

  public enableBeta(): this {
    if (!this._config.supportsBeta) return this

    const base = this._config.baseURL
    if (base.endsWith('/beta') || base.endsWith('/beta/')) {
      return this
    }
    this._config.baseURL = base.endsWith('/') ? `${base}beta/` : `${base}/beta/`
    return this
  }

  private tryEnableBeta(params: InvokeParams) {
    if (params.tools?.some(t => t.strict === true)) {
      this.enableBeta()
    }
  }

  public invoke(params: InvokeParams) {
    this.tryEnableBeta(params)
    return invoke(this._config, params)
  }

  public invokeStream(params: InvokeParams) {
    this.tryEnableBeta(params)
    return invokeStream(this._config, params)
  }

  public fim(params: Omit<FIMParams, 'model'>) {
    this.enableBeta()
    return fim(this._config, params)
  }

  public withConfig(options: Partial<ModelOptions>): DeepSeekModel {
    return new DeepSeekModel(toMerged(this._config, options) as ModelOptions)
  }

  public list(options?: Partial<ListModelsOptions>) {
    return listModels({ ...this._config, ...options })
  }

  public balance(options?: Partial<GetBalanceOptions>) {
    return getBalance({ ...this._config, ...options })
  }
}

export function resolveConfig(options: ModelOptions): ResolvedModelOptions {
  const providerId = options.provider || 'deepseek'
  const providerDef = findProvider(providerId)
  if (!providerDef && !isCustomProviderId(providerId)) {
    throw new Error(`Unknown provider: "${providerId}"`)
  }

  const cleaned = omitBy(options, v => v === undefined || v === '')

  const resolved = toMerged(
    {
      provider: providerId,
      // Custom providers never fall back to server credentials or endpoints.
      apiKey: providerDef ? getServerApiKey(providerDef) || undefined : undefined,
      baseURL: providerDef ? getServerBaseURL(providerDef) : undefined,
      thinkingStyle: providerDef?.thinkingStyle ?? 'none',
      supportsBeta: providerDef?.supportsBeta ?? false,
      thinking: {
        type: 'enabled',
      },
      reasoningEffort: options.thinking?.type === 'disabled' ? undefined : 'high',
      strict: false,
    },
    cleaned,
  ) as ResolvedModelOptions

  if (!resolved.apiKey) {
    throw new Error(providerDef ? `${providerDef.envApiKeyName} is required` : 'apiKey is required')
  }

  if (!resolved.baseURL) {
    throw new Error('baseURL is required')
  }

  if (!resolved.model) {
    throw new Error(`model is required`)
  }

  return resolved
}

export function createModel(options: ModelOptions): DeepSeekModel {
  return new DeepSeekModel(options)
}
