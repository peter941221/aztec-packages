import { CHONK_PROOF_LENGTH } from '@aztec/constants';
import { Fr } from '@aztec/foundation/curves/bn254';
import { numToUInt32BE } from '@aztec/foundation/serialize';

import { ChonkProof, ChonkProofWithPublicInputs } from './chonk_proof.js';

describe('ChonkProof', () => {
  it('should throw error with incorrect length', () => {
    const fields = Array.from({ length: CHONK_PROOF_LENGTH + 1 }, () => Fr.random());
    expect(() => new ChonkProof(fields)).toThrow(`Invalid ChonkProof length: ${CHONK_PROOF_LENGTH + 1}`);
  });

  it('isEmpty should return true for empty proof', () => {
    const proof = ChonkProof.empty();
    expect(proof.isEmpty()).toBe(true);
  });

  it('should serialize and deserialize empty proof', () => {
    const original = ChonkProof.empty();
    const buffer = original.toBuffer();
    const deserialized = ChonkProof.fromBuffer(buffer);

    expect(deserialized.fields.length).toBe(original.fields.length);
    expect(deserialized.fields).toEqual(original.fields);
    expect(deserialized.isEmpty()).toBe(true);
  });

  it('should serialize and deserialize random proof', () => {
    const original = ChonkProof.random();
    const buffer = original.toBuffer();
    const deserialized = ChonkProof.fromBuffer(buffer);

    expect(deserialized.fields.length).toBe(original.fields.length);
    expect(deserialized.fields).toEqual(original.fields);
  });

  it('should attach public inputs', () => {
    const proof = ChonkProof.random();
    const publicInput = Fr.random();
    const withPublicInputs = proof.attachPublicInputs([publicInput]);

    expect(withPublicInputs.fieldsWithPublicInputs.length).toBe(CHONK_PROOF_LENGTH + 1);
    expect(withPublicInputs.fieldsWithPublicInputs[0]).toEqual(publicInput);
    expect(withPublicInputs.fieldsWithPublicInputs.slice(1)).toEqual(proof.fields);
  });

  describe('block-based compression activation', () => {
    const ACTIVATION_BLOCK = 100;
    const fakeCompressedBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);

    function proofWithCompression(): ChonkProof {
      const proof = ChonkProof.random();
      proof.compressedProof = fakeCompressedBytes;
      return proof;
    }

    it('serializes in uncompressed format before activation block', () => {
      const proof = proofWithCompression();
      const forBlock50 = proof.forBlock(50, ACTIVATION_BLOCK);

      const buf = forBlock50.toBuffer();
      // First uint32 should be CHONK_PROOF_LENGTH (field count), not 0 (compressed indicator)
      expect(buf.readUInt32BE(0)).toBe(CHONK_PROOF_LENGTH);
      expect(forBlock50.compressedProof).toBeUndefined();
    });

    it('serializes in compressed format at activation block', () => {
      const proof = proofWithCompression();
      const forBlock100 = proof.forBlock(100, ACTIVATION_BLOCK);

      const buf = forBlock100.toBuffer();
      // First uint32 should be 0 (compressed format indicator)
      expect(buf.readUInt32BE(0)).toBe(0);
      // Second uint32 should be the compressed bytes length
      expect(buf.readUInt32BE(4)).toBe(fakeCompressedBytes.length);
      // Then the compressed bytes themselves
      expect(buf.subarray(8)).toEqual(fakeCompressedBytes);
    });

    it('serializes in compressed format after activation block', () => {
      const proof = proofWithCompression();
      const forBlock200 = proof.forBlock(200, ACTIVATION_BLOCK);

      const buf = forBlock200.toBuffer();
      expect(buf.readUInt32BE(0)).toBe(0);
      expect(forBlock200.compressedProof).toEqual(fakeCompressedBytes);
    });

    it('serializes in uncompressed format when activation is undefined', () => {
      const proof = proofWithCompression();
      const forAnyBlock = proof.forBlock(999, undefined);

      const buf = forAnyBlock.toBuffer();
      expect(buf.readUInt32BE(0)).toBe(CHONK_PROOF_LENGTH);
      expect(forAnyBlock.compressedProof).toBeUndefined();
    });

    it('returns same proof if no compression and before activation', () => {
      const proof = ChonkProof.random();
      expect(proof.compressedProof).toBeUndefined();
      const result = proof.forBlock(50, ACTIVATION_BLOCK);
      expect(result).toBe(proof); // Same reference — no copy needed
    });

    it('preserves field data when stripping compression', () => {
      const proof = proofWithCompression();
      const stripped = proof.forBlock(50, ACTIVATION_BLOCK);
      expect(stripped.fields).toEqual(proof.fields);
    });

    it('uncompressed format roundtrips correctly through forBlock', () => {
      const original = ChonkProof.random();
      original.compressedProof = fakeCompressedBytes;

      // Before activation: use uncompressed format
      const forSerialization = original.forBlock(50, ACTIVATION_BLOCK);
      const buf = forSerialization.toBuffer();
      const deserialized = ChonkProof.fromBuffer(buf);

      expect(deserialized.fields).toEqual(original.fields);
      expect(deserialized.compressedProof).toBeUndefined();
    });

    it('can read uncompressed format regardless of activation setting', () => {
      const proof = ChonkProof.random();
      const buf = proof.toBufferUncompressed();
      const deserialized = ChonkProof.fromBuffer(buf);
      expect(deserialized.fields).toEqual(proof.fields);
    });

    it('detects compressed format by 0 indicator in first uint32', () => {
      // Construct a buffer with compressed format header
      const compressedPayload = Buffer.from([0x01, 0x02, 0x03]);
      const buf = Buffer.concat([
        numToUInt32BE(0), // compressed format indicator
        numToUInt32BE(compressedPayload.length),
        compressedPayload,
      ]);

      // fromBuffer should detect this as compressed format and attempt decompression.
      // Since we're using fake bytes, BarretenbergSync will throw —
      // but the format detection itself works.
      expect(() => ChonkProof.fromBuffer(buf)).toThrow();
    });
  });
});

describe('ChonkProofWithPublicInputs', () => {
  it('constructor should throw error with length less than CHONK_PROOF_LENGTH', () => {
    const fields = Array.from({ length: CHONK_PROOF_LENGTH - 1 }, () => Fr.random());
    expect(() => new ChonkProofWithPublicInputs(fields)).toThrow(
      `Invalid ChonkProofWithPublicInputs length: ${CHONK_PROOF_LENGTH - 1}`,
    );
  });

  it('isEmpty should return true for empty proof', () => {
    const proof = ChonkProofWithPublicInputs.empty();
    expect(proof.isEmpty()).toBe(true);
  });

  it('should serialize and deserialize proof with public inputs', () => {
    const baseProof = ChonkProof.random();
    const publicInputs = Array.from({ length: 5 }, () => Fr.random());
    const original = baseProof.attachPublicInputs(publicInputs);
    const buffer = original.toBuffer();
    const deserialized = ChonkProofWithPublicInputs.fromBuffer(buffer);

    expect(deserialized.fieldsWithPublicInputs.length).toBe(CHONK_PROOF_LENGTH + 5);
    expect(deserialized.fieldsWithPublicInputs).toEqual(original.fieldsWithPublicInputs);
  });

  it('should be able to remove public inputs', () => {
    const baseProof = ChonkProof.random();
    const publicInputs = Array.from({ length: 10 }, () => Fr.random());
    const withPublicInputs = baseProof.attachPublicInputs(publicInputs);
    const removed = withPublicInputs.removePublicInputs();

    expect(removed.fields.length).toBe(CHONK_PROOF_LENGTH);
    expect(removed.fields).toEqual(baseProof.fields);
  });
});
