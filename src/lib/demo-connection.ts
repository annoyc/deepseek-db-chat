export const DEMO_CONNECTION_ID = 'server-demo'

export function isDemoConnectionId(id: string | null | undefined): boolean {
  return id === DEMO_CONNECTION_ID
}
