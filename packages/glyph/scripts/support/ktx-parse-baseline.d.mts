export interface KtxParseBaselineFormat {
  readonly vkFormat: number;
  readonly typeSize?: number;
  readonly blockWidth: number;
  readonly blockHeight: number;
  readonly bytesPerBlock: number;
  readonly uncompressedChannelTypes?: readonly number[];
  readonly float16ChannelTypes?: readonly number[];
}

export function validateKtxParseBaseline(
  bytes: Uint8Array,
  width: number,
  height: number,
  format: KtxParseBaselineFormat,
): Uint8Array;
