import type { LogFn, Logger } from '@aztec/foundation/log';
import { Timer } from '@aztec/foundation/timer';
import type { AvmCircuitInputs, AvmCircuitPublicInputs } from '@aztec/stdlib/avm';

import * as proc from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import readline from 'readline';

export const VK_FILENAME = 'vk';
export const PUBLIC_INPUTS_FILENAME = 'public_inputs';
export const PROOF_FILENAME = 'proof';
export const AVM_INPUTS_FILENAME = 'avm_inputs.bin';
export const AVM_BYTECODE_FILENAME = 'avm_bytecode.bin';
export const AVM_PUBLIC_INPUTS_FILENAME = 'avm_public_inputs.bin';

export enum BB_RESULT {
  SUCCESS,
  FAILURE,
  ALREADY_PRESENT,
}

export type BBSuccess = {
  status: BB_RESULT.SUCCESS | BB_RESULT.ALREADY_PRESENT;
  durationMs: number;
  /** Full path of the public key. */
  pkPath?: string;
  /** Base directory for the VKs (raw, fields). */
  vkDirectoryPath?: string;
  /** Full path of the proof. */
  proofPath?: string;
  /** Full path of the contract. */
  contractPath?: string;
  /** The number of gates in the circuit. */
  circuitSize?: number;
};

export type BBFailure = {
  status: BB_RESULT.FAILURE;
  reason: string;
  retry?: boolean;
};

export type BBResult = BBSuccess | BBFailure;

type BBExecResult = {
  status: BB_RESULT;
  exitCode: number;
  signal: string | undefined;
};

export const DEFAULT_BB_VERIFY_CONCURRENCY = 4;

/**
 * Invokes the Barretenberg binary with the provided command and args
 * @param pathToBB - The path to the BB binary
 * @param command - The command to execute
 * @param args - The arguments to pass
 * @param logger - A log function
 * @param concurrency - An optional concurrency setting
 * @param timeout - An optional timeout before killing the BB process
 * @param resultParser - An optional handler for detecting success or failure
 * @returns The completed partial witness outputted from the circuit
 */
export function executeBB(
  pathToBB: string,
  command: string,
  args: string[],
  logger: LogFn,
  concurrency?: number,
  timeout?: number,
  resultParser = (code: number) => code === 0,
): Promise<BBExecResult> {
  return new Promise<BBExecResult>(resolve => {
    // spawn the bb process
    const { HARDWARE_CONCURRENCY: _, ...envWithoutConcurrency } = process.env;

    const env = envWithoutConcurrency;
    // We prioritise the concurrency argument if provided and > 0
    if (concurrency && concurrency > 0) {
      env.HARDWARE_CONCURRENCY = concurrency.toString();
    } else if (process.env.HARDWARE_CONCURRENCY) {
      env.HARDWARE_CONCURRENCY = process.env.HARDWARE_CONCURRENCY;
    }

    logger(`BB concurrency: ${env.HARDWARE_CONCURRENCY}`);
    logger(`Executing BB with: ${pathToBB} ${command} ${args.join(' ')}`);
    const bb = proc.spawn(pathToBB, [command, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let timeoutId: NodeJS.Timeout | undefined;
    if (timeout !== undefined) {
      timeoutId = setTimeout(() => {
        logger(`BB execution timed out after ${timeout}ms, killing process`);
        if (bb.pid) {
          bb.kill('SIGKILL');
        }
        resolve({ status: BB_RESULT.FAILURE, exitCode: -1, signal: 'TIMEOUT' });
      }, timeout);
    }

    readline.createInterface({ input: bb.stdout }).on('line', logger);
    readline.createInterface({ input: bb.stderr }).on('line', logger);

    bb.on('close', (exitCode: number, signal?: string) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (resultParser(exitCode)) {
        resolve({ status: BB_RESULT.SUCCESS, exitCode, signal });
      } else {
        resolve({ status: BB_RESULT.FAILURE, exitCode, signal });
      }
    });
  }).catch(_ => ({ status: BB_RESULT.FAILURE, exitCode: -1, signal: undefined }));
}

/**
 * Used for generating AVM proofs.
 * It is assumed that the working directory is a temporary and/or random directory used solely for generating this proof.
 * @param pathToBB - The full path to the bb binary
 * @param workingDirectory - A working directory for use by bb
 * @param input - The inputs for the public function to be proven
 * @param logger - A logging function
 * @param checkCircuitOnly - A boolean to toggle a "check-circuit only" operation instead of proving.
 * @returns An object containing a result indication, the location of the proof and the duration taken
 */
export async function generateAvmProof(
  pathToBB: string,
  workingDirectory: string,
  input: AvmCircuitInputs,
  logger: Logger,
  checkCircuitOnly: boolean = false,
): Promise<BBFailure | BBSuccess> {
  // Check that the working directory exists
  try {
    await fs.access(workingDirectory);
  } catch {
    return { status: BB_RESULT.FAILURE, reason: `Working directory ${workingDirectory} does not exist` };
  }

  // The proof is written to e.g. /workingDirectory/proof
  const outputPath = workingDirectory;

  const filePresent = async (file: string) =>
    await fs
      .access(file, fs.constants.R_OK)
      .then(_ => true)
      .catch(_ => false);

  const binaryPresent = await filePresent(pathToBB);
  if (!binaryPresent) {
    return { status: BB_RESULT.FAILURE, reason: `Failed to find bb binary at ${pathToBB}` };
  }

  const inputsBuffer = input.serializeWithMessagePack();

  try {
    // Write the inputs to the working directory.
    const avmInputsPath = join(workingDirectory, AVM_INPUTS_FILENAME);
    await fs.writeFile(avmInputsPath, inputsBuffer);
    if (!(await filePresent(avmInputsPath))) {
      return { status: BB_RESULT.FAILURE, reason: `Could not write avm inputs to ${avmInputsPath}` };
    }

    const args = checkCircuitOnly ? ['--avm-inputs', avmInputsPath] : ['--avm-inputs', avmInputsPath, '-o', outputPath];
    const loggingArg =
      logger.level === 'debug' || logger.level === 'trace' ? '-d' : logger.level === 'verbose' ? '-v' : '';
    if (loggingArg !== '') {
      args.push(loggingArg);
    }
    const timer = new Timer();

    const cmd = checkCircuitOnly ? 'avm_check_circuit' : 'avm_prove';
    const logFunction = (message: string) => {
      logger.verbose(`AvmCircuit (${cmd}) BB out - ${message}`);
    };
    const result = await executeBB(pathToBB, cmd, args, logFunction);
    const duration = timer.ms();

    if (result.status == BB_RESULT.SUCCESS) {
      return {
        status: BB_RESULT.SUCCESS,
        durationMs: duration,
        proofPath: join(outputPath, PROOF_FILENAME),
        pkPath: undefined,
        vkDirectoryPath: undefined, // AVM VK is fixed in the binary.
      };
    }
    // Not a great error message here but it is difficult to decipher what comes from bb
    return {
      status: BB_RESULT.FAILURE,
      reason: `Failed to generate proof. AVM proof for TX hash ${input.hints.tx.hash}. Exit code ${result.exitCode}. Signal ${result.signal}.`,
      retry: result.signal === 'SIGKILL', // retry on SIGKILL because the oomkiller might have stopped the process
    };
  } catch (error) {
    return { status: BB_RESULT.FAILURE, reason: `${error}` };
  }
}

export async function verifyAvmProof(
  pathToBB: string,
  workingDirectory: string,
  proofFullPath: string,
  publicInputs: AvmCircuitPublicInputs,
  logger: Logger,
): Promise<BBFailure | BBSuccess> {
  const inputsBuffer = publicInputs.serializeWithMessagePack();

  // Write the inputs to the working directory.
  const filePresent = async (file: string) =>
    await fs
      .access(file, fs.constants.R_OK)
      .then(_ => true)
      .catch(_ => false);
  const avmInputsPath = join(workingDirectory, 'avm_public_inputs.bin');
  await fs.writeFile(avmInputsPath, inputsBuffer);
  if (!(await filePresent(avmInputsPath))) {
    return { status: BB_RESULT.FAILURE, reason: `Could not write avm inputs to ${avmInputsPath}` };
  }

  const args = ['-p', proofFullPath, '--avm-public-inputs', avmInputsPath];
  return await verifyProofInternal(pathToBB, 'avm_verify', args, logger);
}

/**
 * Used for verifying proofs with BB
 * @param pathToBB - The full path to the bb binary
 * @param command - The BB command to execute (verify/avm_verify)
 * @param args - The arguments to pass to the command
 * @param logger - A logger
 * @param concurrency - The number of threads to use for the verification
 * @returns An object containing a result indication and duration taken
 */
async function verifyProofInternal(
  pathToBB: string,
  command: 'verify' | 'avm_verify',
  args: string[],
  logger: Logger,
  concurrency?: number,
): Promise<BBFailure | BBSuccess> {
  const binaryPresent = await fs
    .access(pathToBB, fs.constants.R_OK)
    .then(_ => true)
    .catch(_ => false);
  if (!binaryPresent) {
    return { status: BB_RESULT.FAILURE, reason: `Failed to find bb binary at ${pathToBB}` };
  }

  const logFunction = (message: string) => {
    logger.verbose(`bb-prover (verify) BB out - ${message}`);
  };

  try {
    const loggingArg =
      logger.level === 'debug' || logger.level === 'trace' ? '-d' : logger.level === 'verbose' ? '-v' : '';
    const finalArgs = loggingArg !== '' ? [...args, loggingArg] : args;

    const timer = new Timer();
    const result = await executeBB(pathToBB, command, finalArgs, logFunction, concurrency);
    const duration = timer.ms();
    if (result.status == BB_RESULT.SUCCESS) {
      return { status: BB_RESULT.SUCCESS, durationMs: duration };
    }
    // Not a great error message here but it is difficult to decipher what comes from bb
    return {
      status: BB_RESULT.FAILURE,
      reason: `Failed to verify proof. Exit code ${result.exitCode}. Signal ${result.signal}.`,
      retry: !!result.signal,
    };
  } catch (error) {
    return { status: BB_RESULT.FAILURE, reason: `${error}` };
  }
}
