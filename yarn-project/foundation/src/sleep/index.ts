import { AbortError, InterruptError } from '../error/index.js';

/**
 * InterruptibleSleep is a utility class that allows you to create an interruptible sleep function.
 * The sleep function can be interrupted at any time by calling the `interrupt` method, which can
 * also specify whether the sleep should throw an error or just return. This is useful when you need
 * to terminate long-running processes or perform cleanup tasks in response to external events.
 *
 * @example
 * const sleeper = new InterruptibleSleep();
 *
 * async function longRunningTask() \{
 *   try \{
 *     await sleeper.sleep(3000);
 *     console.log('Task completed after 3 seconds');
 *   \} catch (e) \{
 *     console.log('Task was interrupted');
 *   \}
 * \}
 *
 * setTimeout(() =\> sleeper.interrupt(true), 1500); // Interrupt the sleep after 1.5 seconds
 */
export class InterruptibleSleep {
  private interrupts: Array<(shouldThrow: boolean) => void> = [];
  private timeoutIds: NodeJS.Timeout[] = [];

  /**
   * Sleep for a specified amount of time in milliseconds.
   * The sleep function will pause the execution of the current async function
   * for the given time period, allowing other tasks to run before resuming.
   * If an AbortSignal is provided, the sleep can be cut short when the signal fires.
   *
   * @param ms - The number of milliseconds to sleep.
   * @param signal - Optional AbortSignal to interrupt the sleep early.
   * @param opts - Options controlling behaviour on abort. If `throwOnAbort` is true, the sleep throws `signal.reason`; otherwise it resolves silently.
   * @returns A Promise that resolves after the specified time has passed.
   */
  public async sleep(ms: number, signal?: AbortSignal, opts?: { throwOnAbort?: boolean }): Promise<void> {
    let interruptResolve: (shouldThrow: boolean) => void;
    const interruptPromise = new Promise<boolean>(resolve => {
      interruptResolve = resolve;
      this.interrupts.push(resolve);
    });

    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<boolean>(resolve => {
      timeoutId = setTimeout(() => resolve(false), ms);
      this.timeoutIds.push(timeoutId);
    });

    // Listen for AbortSignal if provided
    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        interruptResolve!(opts?.throwOnAbort ?? false);
      } else {
        onAbort = () => interruptResolve!(opts?.throwOnAbort ?? false);
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const shouldThrow = await Promise.race([interruptPromise, timeoutPromise]);

    clearTimeout(timeoutId!);
    this.timeoutIds = this.timeoutIds.filter(id => id !== timeoutId);
    this.interrupts = this.interrupts.filter(res => res !== interruptResolve);
    if (onAbort && signal) {
      signal.removeEventListener('abort', onAbort);
    }

    if (shouldThrow) {
      throw signal?.reason ?? new InterruptError('Interrupted.');
    }
  }

  /**
   * Interrupts the current sleep operation and optionally throws an error if specified.
   * By default, when interrupted, the sleep operation will resolve without throwing.
   * If 'sleepShouldThrow' is set to true, the sleep operation will throw an InterruptError instead.
   *
   * @param sleepShouldThrow - A boolean value indicating whether the sleep operation should throw an error when interrupted. Default is false.
   */
  public interrupt(sleepShouldThrow = false): void {
    this.interrupts.forEach(resolve => resolve(sleepShouldThrow));
    this.interrupts = [];
    this.timeoutIds.forEach(id => clearTimeout(id));
    this.timeoutIds = [];
  }
}

/**
 * Puts the current execution context to sleep for a specified duration.
 * This simulates a blocking sleep operation by using an asynchronous function and a Promise that resolves after the given duration.
 * The sleep function can be interrupted by the 'interrupt' method of the InterruptibleSleep class.
 *
 * @param ms - The duration in milliseconds for which the sleep operation should last.
 * @param returnValue - The return value of the promise.
 * @returns A Promise that resolves after the specified duration, allowing the use of 'await' to pause execution.
 */
export function sleep<T>(ms: number, returnValue?: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(returnValue as T), ms));
}

/** Sleeps until the target date */
export function sleepUntil<T>(target: Date, now: Date, returnValue?: T): Promise<T> {
  const ms = target.getTime() - now.getTime();
  return sleep(ms, returnValue);
}

/**
 * Sleeps for the given duration. If an AbortSignal is provided, the sleep
 * rejects with `signal.reason` (or AbortError) when the signal fires.
 * Without a signal, behaves identically to `sleep()`.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new AbortError('Aborted'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new AbortError('Aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
