/** DeepSeek Harness Connection RPC adapter for the Usage Service. */

const RPC_CHANNEL = '/api'
const RPC_NAMESPACE = 'usage'

interface RpcFailure {
  readonly code?: string
}

type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: RpcFailure }

interface ConnectionRpc {
  call<T>(
    channel: string,
    endpoint: string,
    payload: { readonly args: Readonly<Record<string, unknown>> },
  ): Promise<RpcResult<T>>
}

interface ConnectionHandle {
  readonly rpc: ConnectionRpc
}

interface ClientContext {
  get(name: 'connection'): ConnectionHandle | undefined
}

export interface UsageConfigInput {
  readonly token?: string
  readonly apiKey?: string
}

export interface UsageApi {
  snapshot(): Promise<unknown>
  getConfig(): Promise<unknown>
  setConfig(cfg: UsageConfigInput): Promise<{ ok: boolean }>
  resetLocal(): Promise<{ ok: boolean }>
  refresh(): Promise<{ ok: boolean }>
}

/**
 * Create the only browser-side access path to the Host Usage Service.
 * @param ctx - Client Cordis context carrying the Connection service.
 * @returns named methods that send the Gateway's exact `{ args }` payload.
 */
export function createUsageApi(ctx: ClientContext): UsageApi {
  const connection = ctx.get('connection')
  if (connection?.rpc?.call === undefined) {
    throw new Error('dsh-usage-panel: connection RPC service is unavailable')
  }

  const call = async <T>(method: string, args: Readonly<Record<string, unknown>>): Promise<T> => {
    const result = await connection.rpc.call<T>(
      RPC_CHANNEL,
      `${RPC_NAMESPACE}/${method}`,
      { args },
    )
    if (result.ok === true) return result.value
    const code = result.error?.code ?? 'unknown'
    throw new Error(`dsh-usage-panel: usage/${method} failed (${code})`)
  }

  return {
    snapshot: () => call('snapshot', {}),
    getConfig: () => call('getConfig', {}),
    setConfig: cfg => call('setConfig', { cfg }),
    resetLocal: () => call('resetLocal', {}),
    refresh: () => call('refresh', {}),
  }
}
