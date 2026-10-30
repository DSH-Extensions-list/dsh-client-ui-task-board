/** Bind internal board calls to DSH's existing local-owner browser peer. */
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionGateway } from './host-runner.ts'

export function bindHostGateway(gateway: TypertGateway, peer: () => PeerScope): SessionGateway {
  return {
    invoke: request => gateway.invoke({ ...request, peer: peer() }),
    stream: request => gateway.stream({ ...request, peer: peer() }),
  }
}
