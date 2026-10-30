/** Bind internal board calls to DSH's existing local-owner browser peer. */
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway';
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionGateway } from './host-runner.ts';
export declare function bindHostGateway(gateway: TypertGateway, peer: () => PeerScope): SessionGateway;
