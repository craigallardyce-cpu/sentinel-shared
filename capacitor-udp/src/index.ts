export type { SentinelUdpPlugin, UdpDatagramEvent, UdpErrorEvent } from './definitions.js';
export { SentinelUdp, isUdpAvailable } from './plugin.js';
export {
  CapacitorUdpClient,
  UDP_DATA_TIMEOUT_MS,
  listenForSentences,
  sourceMatches,
  splitDatagram,
} from './client.js';
export type { CapacitorUdpClientOptions, ListenForSentencesOptions } from './client.js';
