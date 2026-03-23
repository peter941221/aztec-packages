import {
  BBJsProverFactory,
  BB_RESULT,
  type UltraHonkFlavor,
  constructRecursiveProofFromBuffers,
  generateAvmProof,
  verifyAvmProof,
} from '@aztec/bb-prover';
import {
  AVM_V2_PROOF_LENGTH_IN_FIELDS_PADDED,
  CHONK_PROOF_LENGTH,
  HIDING_KERNEL_IO_PUBLIC_INPUTS_SIZE,
  NESTED_RECURSIVE_PROOF_LENGTH,
  RECURSIVE_ROLLUP_HONK_PROOF_LENGTH,
} from '@aztec/constants';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { Logger } from '@aztec/foundation/log';
import { BufferReader } from '@aztec/foundation/serialize';
import type { AvmCircuitInputs, AvmCircuitPublicInputs } from '@aztec/stdlib/avm';
import { makeProofAndVerificationKey } from '@aztec/stdlib/interfaces/server';
import type { NoirCompiledCircuit } from '@aztec/stdlib/noir';
import { Proof, RecursiveProof } from '@aztec/stdlib/proofs';
import { VerificationKeyAsFields, VerificationKeyData } from '@aztec/stdlib/vks';

import * as fs from 'fs/promises';
import { ungzip } from 'pako';
import * as path from 'path';

export async function proofBytesToRecursiveProof(
  proofAsFields: Uint8Array[],
  vkBytes: Uint8Array,
): Promise<RecursiveProof<typeof CHONK_PROOF_LENGTH>> {
  const vk = await VerificationKeyAsFields.fromFrBuffer(Buffer.from(vkBytes));
  const numCustomPublicInputs = vk.numPublicInputs - HIDING_KERNEL_IO_PUBLIC_INPUTS_SIZE;
  // Convert Uint8Array fields to Fr instances
  const fields = proofAsFields.map(f => Fr.fromBuffer(Buffer.from(f)));

  // Slice off custom public inputs from the beginning.
  const fieldsWithoutPublicInputs = fields.slice(numCustomPublicInputs);

  // Convert fields to binary buffer
  const proofBuffer = Buffer.concat(proofAsFields.slice(numCustomPublicInputs));

  // Create Proof directly (not using fromBuffer which expects different format)
  const proof = new Proof(proofBuffer, numCustomPublicInputs);
  return new RecursiveProof(fieldsWithoutPublicInputs, proof, true, CHONK_PROOF_LENGTH);
}

async function proveRollupCircuit<T extends UltraHonkFlavor, ProofLength extends number>(
  name: string,
  pathToBB: string,
  _workingDirectory: string,
  circuit: NoirCompiledCircuit,
  witness: Uint8Array,
  logger: Logger,
  flavor: T,
  proofLength: ProofLength,
) {
  const factory = new BBJsProverFactory(pathToBB, logger);

  // Decompress witness and bytecode for bb.js
  const decompressedWitness = ungzip(witness);
  const bytecode = ungzip(Buffer.from(circuit.bytecode, 'base64'));
  const vkBuffer = Buffer.from(circuit.verificationKey.bytes, 'hex');

  // Generate proof via bb.js
  const proofResult = await factory.withFreshInstance(instance =>
    instance.generateProof(name, bytecode, vkBuffer, decompressedWitness, flavor),
  );

  const vk = await VerificationKeyData.fromFrBuffer(vkBuffer);

  // Construct proof from in-memory buffers
  const proof = constructRecursiveProofFromBuffers(
    proofResult.proofFields,
    proofResult.publicInputFields,
    vk,
    proofLength,
  );

  // Verify the proof via bb.js
  const publicInputFields = proofResult.publicInputFields;
  const proofFields = proofResult.proofFields;

  const { verified } = await factory.withVerifierInstance(instance =>
    instance.verifyProof(proofFields, vk.keyAsBytes, publicInputFields, flavor),
  );

  if (!verified) {
    throw new Error(`Failed to verify proof from key!`);
  }
  logger.info(`Successfully verified proof from key`);

  return makeProofAndVerificationKey(proof, vk);
}

export function proveRollupHonk(
  name: string,
  pathToBB: string,
  workingDirectory: string,
  circuit: NoirCompiledCircuit,
  witness: Uint8Array,
  logger: Logger,
) {
  return proveRollupCircuit(
    name,
    pathToBB,
    workingDirectory,
    circuit,
    witness,
    logger,
    'ultra_rollup_honk',
    RECURSIVE_ROLLUP_HONK_PROOF_LENGTH,
  );
}

export function proveKeccakHonk(
  name: string,
  pathToBB: string,
  workingDirectory: string,
  circuit: NoirCompiledCircuit,
  witness: Uint8Array,
  logger: Logger,
) {
  return proveRollupCircuit(
    name,
    pathToBB,
    workingDirectory,
    circuit,
    witness,
    logger,
    'ultra_keccak_honk',
    NESTED_RECURSIVE_PROOF_LENGTH,
  );
}

/** AVM proving still uses direct binary execution (no bb.js equivalent). */
export async function proveAvm(
  avmCircuitInputs: AvmCircuitInputs,
  workingDirectory: string,
  logger: Logger,
): Promise<{
  proof: Fr[];
  publicInputs: AvmCircuitPublicInputs;
}> {
  // The paths for the barretenberg binary and the write path are hardcoded for now.
  const bbPath = path.resolve('../../barretenberg/cpp/build/bin/bb-avm');

  // Then we prove.
  const proofRes = await generateAvmProof(bbPath, workingDirectory, avmCircuitInputs, logger);
  if (proofRes.status === BB_RESULT.FAILURE) {
    throw new Error(`AVM V2 proof generation failed: ${proofRes.reason}`);
  } else if (proofRes.status === BB_RESULT.ALREADY_PRESENT) {
    throw new Error(`AVM V2 proof already exists`);
  }

  const avmProofPath = proofRes.proofPath;
  expect(avmProofPath).toBeDefined();

  // Read the binary proof
  const avmProofBuffer = await fs.readFile(avmProofPath!);
  const reader = BufferReader.asReader(avmProofBuffer);

  const proof: Fr[] = [];
  while (!reader.isEmpty()) {
    proof.push(Fr.fromBuffer(reader));
  }

  // We extend to a fixed-size padded proof as during development any new AVM circuit column changes the
  // proof length and we do not have a mechanism to feedback a cpp constant to noir/TS.
  // TODO(#13390): Revive a non-padded AVM proof
  while (proof.length < AVM_V2_PROOF_LENGTH_IN_FIELDS_PADDED) {
    proof.push(new Fr(0));
  }

  const verificationResult = await verifyAvmProof(
    bbPath,
    workingDirectory,
    proofRes.proofPath!,
    avmCircuitInputs.publicInputs,
    logger,
  );

  if (verificationResult.status === BB_RESULT.FAILURE) {
    throw new Error(`AVM V2 proof verification failed: ${verificationResult.reason}`);
  }

  return {
    proof,
    publicInputs: avmCircuitInputs.publicInputs,
  };
}
