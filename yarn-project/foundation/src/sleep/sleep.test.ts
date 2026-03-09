import { jest } from '@jest/globals';

import { InterruptError } from '../error/index.js';
import { InterruptibleSleep, abortableSleep } from './index.js';

describe('InterruptibleSleep', () => {
  it('should sleep for 100ms', async () => {
    const sleeper = new InterruptibleSleep();
    const start = Date.now();
    await sleeper.sleep(100);
    const end = Date.now();
    // -10 ms wiggle room for rounding errors
    expect(end - start).toBeGreaterThanOrEqual(90);
  });

  it('can start multiple sleeps', async () => {
    const sleeper = new InterruptibleSleep();
    const start = Date.now();
    await Promise.all([sleeper.sleep(100), sleeper.sleep(150)]);
    const end = Date.now();
    // -10 ms wiggle room for rounding errors
    expect(end - start).toBeGreaterThanOrEqual(140);
  });

  it('can interrupt multiple sleeps', async () => {
    const stub = jest.fn();
    const sleeper = new InterruptibleSleep();
    const start = Date.now();
    let end1;
    const sleep1 = sleeper.sleep(100).then(() => {
      end1 = Date.now();
    });
    const sleep2 = sleeper.sleep(150).then(stub);
    setTimeout(() => sleeper.interrupt(true), 125);
    await Promise.all([sleep1, sleep2]).catch(e => expect(e).toBeInstanceOf(InterruptError));
    // -10 ms wiggle room for rounding errors
    expect(end1! - start).toBeGreaterThanOrEqual(90);
    expect(stub).not.toHaveBeenCalled();
  });

  it('should resolve when signal is aborted (non-throwing)', async () => {
    const sleeper = new InterruptibleSleep();
    const controller = new AbortController();
    const promise = sleeper.sleep(5000, controller.signal);
    setTimeout(() => controller.abort(new Error('aborted')), 50);
    await expect(promise).resolves.toBeUndefined();
  });

  it('should throw signal.reason when signal is aborted with throwOnAbort', async () => {
    const sleeper = new InterruptibleSleep();
    const controller = new AbortController();
    const promise = sleeper.sleep(5000, controller.signal, { throwOnAbort: true });
    setTimeout(() => controller.abort(new Error('test reason')), 50);
    await expect(promise).rejects.toThrow('test reason');
  });
});

describe('abortableSleep', () => {
  it('resolves after the given time', async () => {
    const start = Date.now();
    await abortableSleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    await expect(abortableSleep(5000, controller.signal)).rejects.toThrow('already aborted');
  });

  it('rejects when signal is aborted during sleep', async () => {
    const controller = new AbortController();
    const promise = abortableSleep(5000, controller.signal);
    setTimeout(() => controller.abort(new Error('interrupted')), 50);
    await expect(promise).rejects.toThrow('interrupted');
  });

  it('resolves normally without a signal', async () => {
    await expect(abortableSleep(10)).resolves.toBeUndefined();
  });
});
