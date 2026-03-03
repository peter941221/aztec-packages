import { BarretenbergSync, flattenChonkProofFields } from '@aztec/bb.js';
import { CHONK_PROOF_LENGTH } from '@aztec/constants';
import { times } from '@aztec/foundation/collection';
import { randomBytes } from '@aztec/foundation/crypto/random';
import { Fr } from '@aztec/foundation/curves/bn254';
import { bufferSchemaFor } from '@aztec/foundation/schemas';
import { BufferReader, numToUInt32BE, serializeToBuffer } from '@aztec/foundation/serialize';

/**
 * Serialization format detection for ChonkProof is size-based:
 *   - UNCOMPRESSED (legacy): [field_count=1632: uint32] [fields...]  → total ≈ 52KB (>= 40KB)
 *   - COMPRESSED:            [byte_count: uint32] [compressed_bytes] → total ≈ 35KB (< 40KB)
 *
 * Detection: if the first uint32 equals CHONK_PROOF_LENGTH (1632), it's legacy format
 * (field count). Otherwise, it's compressed format (byte count). The old uncompressed
 * format is never smaller than 40KB; compressed proofs are always smaller than 40KB.
 */

// CHONK: "Client Honk" - An UltraHonk variant with incremental folding and delayed non-native arithmetic.
export class ChonkProof {
  /**
   * Optional compressed proof bytes from chonk compression (point compression + u256 encoding).
   * When set, toBuffer() will serialize in compressed format (~1.7x smaller).
   * When reading from compressed format, this is populated and fields are decompressed on demand.
   */
  public compressedProof?: Buffer;

  constructor(
    // The proof fields.
    // For native verification, attach public inputs via `attachPublicInputs(publicInputs)`.
    // Not using Tuple here due to the length being too high.
    public fields: Fr[],
    compressedProof?: Buffer,
  ) {
    if (fields.length !== CHONK_PROOF_LENGTH) {
      throw new Error(`Invalid ChonkProof length: ${fields.length}`);
    }
    this.compressedProof = compressedProof;
  }

  public attachPublicInputs(publicInputs: Fr[]) {
    return new ChonkProofWithPublicInputs([...publicInputs, ...this.fields]);
  }

  public isEmpty() {
    return this.fields.every(field => field.isZero());
  }

  static empty() {
    return new ChonkProof(new Array(CHONK_PROOF_LENGTH).fill(Fr.ZERO));
  }

  static random() {
    // NB: Not using Fr.random here because it slows down some tests that require a large number of txs significantly.
    // NB2: generate one fewer random bytes to not have to deal with buffers representing numbers greater than the field modulus
    // NB3: a chonk proof can be compressed. Simulate this by filling 1/4 of the proof with zero data
    const reducedFrSize = Fr.SIZE_IN_BYTES - 1;
    const nonZeroFields = Math.floor((3 * CHONK_PROOF_LENGTH) / 4);
    const randomFields = randomBytes(nonZeroFields * Fr.SIZE_IN_BYTES);
    const proof = [
      ...times(nonZeroFields, i => new Fr(randomFields.subarray(i * reducedFrSize, (i + 1) * reducedFrSize))),
      ...times(CHONK_PROOF_LENGTH - nonZeroFields, () => Fr.ZERO),
    ];
    return new ChonkProof(proof);
  }

  static get schema() {
    return bufferSchemaFor(ChonkProof);
  }

  // We use this in tandem with the bufferSchemaFor to serialize to base64 strings.
  toJSON() {
    return this.toBuffer();
  }

  /**
   * Deserialize a ChonkProof from a buffer.
   * Supports both legacy (field elements) and compressed (chonk compression) formats.
   *
   * Size-based format detection:
   *   - First uint32 == CHONK_PROOF_LENGTH (1632): legacy format, read field elements
   *     Total proof data ≈ 52KB (always >= 40KB)
   *   - Otherwise: compressed format, first uint32 is byte count of compressed data
   *     Total proof data ≈ 35KB (always < 40KB)
   */
  static fromBuffer(buffer: Buffer | BufferReader): ChonkProof {
    const reader = BufferReader.asReader(buffer);
    const firstUint32 = reader.readNumber();

    if (firstUint32 === CHONK_PROOF_LENGTH) {
      // Legacy format: firstUint32 is the field count (1632)
      const proof = reader.readArray(firstUint32, Fr);
      return new ChonkProof(proof);
    }

    // Compressed format: firstUint32 is the compressed byte count
    const compressedBytes = reader.readBytes(firstUint32);
    return ChonkProof.fromCompressedBytes(Buffer.from(compressedBytes));
  }

  /**
   * Create a ChonkProof from compressed bytes by decompressing via the BarretenbergSync API.
   * The compressed format uses point compression and u256 encoding (from PR #20645).
   *
   * @param compressed - Compressed proof bytes from chonk compression
   * @returns ChonkProof with both fields and compressed bytes populated
   */
  static fromCompressedBytes(compressed: Buffer): ChonkProof {
    const api = BarretenbergSync.getSingleton();
    const result = api.chonkDecompressProof({ compressedProof: new Uint8Array(compressed) });

    // Flatten the structured bb.js ChonkProof into flat Fr[] field elements
    const flatFields = flattenChonkProofFields(result.proof);
    const fields = flatFields.map(f => Fr.fromBuffer(Buffer.from(f)));

    // The decompressed proof includes public inputs in megaProof.
    // Since ChonkProof stores fields WITHOUT public inputs, strip them.
    // The number of public inputs = total fields - CHONK_PROOF_LENGTH
    if (fields.length > CHONK_PROOF_LENGTH) {
      const numPubInputs = fields.length - CHONK_PROOF_LENGTH;
      const proofFields = fields.slice(numPubInputs);
      return new ChonkProof(proofFields, compressed);
    }

    return new ChonkProof(fields, compressed);
  }

  /**
   * Serialize the proof to a buffer.
   * If compressed bytes are available, uses the compressed format (~1.7x smaller).
   * Otherwise falls back to legacy field element format.
   */
  public toBuffer() {
    if (this.compressedProof) {
      // Compressed format: [compressed_byte_count: uint32] [compressed_bytes]
      return Buffer.concat([numToUInt32BE(this.compressedProof.length), this.compressedProof]);
    }
    // Legacy format: [field_count=1632: uint32] [fields...]
    return serializeToBuffer(this.fields.length, this.fields);
  }

  /**
   * Serialize using the legacy (uncompressed) format regardless of whether
   * compressed bytes are available. Used when backward compatibility is required.
   */
  public toBufferUncompressed() {
    return serializeToBuffer(this.fields.length, this.fields);
  }

  /**
   * Return a ChonkProof suitable for serialization at the given block number.
   * Before the activation block, compressed bytes are stripped so that toBuffer()
   * produces the legacy format. At or after the activation block, compressed
   * bytes are preserved so toBuffer() produces the compressed format.
   *
   * @param blockNumber - The current L2 block number
   * @param compressionActivationBlock - The block at which compressed format is activated.
   *   If undefined, compression is never used (legacy-only mode).
   * @returns A ChonkProof that serializes in the appropriate format
   */
  public forBlock(blockNumber: number, compressionActivationBlock: number | undefined): ChonkProof {
    if (compressionActivationBlock !== undefined && blockNumber >= compressionActivationBlock && this.compressedProof) {
      return this;
    }
    // Strip compressed bytes — will serialize in legacy format
    if (this.compressedProof) {
      return new ChonkProof(this.fields);
    }
    return this;
  }
}

export class ChonkProofWithPublicInputs {
  /**
   * Optional compressed proof bytes (covers the full proof WITH public inputs).
   * Set by the prover when using chonk compression. Flows through to ChonkProof
   * via removePublicInputs() so the Tx can serialize in compressed format.
   */
  public compressedProof?: Buffer;

  constructor(
    // The proof fields with public inputs.
    // For recursive verification, use without public inputs via `removePublicInputs()`.
    public fieldsWithPublicInputs: Fr[],
  ) {
    if (fieldsWithPublicInputs.length < CHONK_PROOF_LENGTH) {
      throw new Error(`Invalid ChonkProofWithPublicInputs length: ${fieldsWithPublicInputs.length}`);
    }
  }

  public getPublicInputs() {
    const numPublicInputs = this.fieldsWithPublicInputs.length - CHONK_PROOF_LENGTH;
    return this.fieldsWithPublicInputs.slice(0, numPublicInputs);
  }

  public removePublicInputs() {
    const numPublicInputs = this.fieldsWithPublicInputs.length - CHONK_PROOF_LENGTH;
    // Flow compressed proof bytes through so the ChonkProof can serialize efficiently
    return new ChonkProof(this.fieldsWithPublicInputs.slice(numPublicInputs), this.compressedProof);
  }

  public isEmpty() {
    return this.fieldsWithPublicInputs.every(field => field.isZero());
  }

  static empty() {
    return ChonkProof.empty().attachPublicInputs([]);
  }

  static get schema() {
    return bufferSchemaFor(ChonkProofWithPublicInputs);
  }

  // We use this in tandem with the bufferSchemaFor to serialize to base64 strings.
  toJSON() {
    return this.toBuffer();
  }

  static fromBuffer(buffer: Buffer | BufferReader): ChonkProofWithPublicInputs {
    const reader = BufferReader.asReader(buffer);
    const proofLength = reader.readNumber();
    const proof = reader.readArray(proofLength, Fr);
    return new ChonkProofWithPublicInputs(proof);
  }

  public toBuffer() {
    return serializeToBuffer(this.fieldsWithPublicInputs.length, this.fieldsWithPublicInputs);
  }

  // Called when constructing from bb proving results.
  static fromBufferArray(fields: Uint8Array[]): ChonkProofWithPublicInputs {
    const proof = fields.map(field => Fr.fromBuffer(Buffer.from(field)));
    return new ChonkProofWithPublicInputs(proof);
  }
}
