import { createServer } from 'node:net';

export const LOOPBACK_HOST = '127.0.0.1';

/** Lets the OS select an unused private-server port without guessing or retrying. */
export async function selectLoopbackPort(): Promise<number> {
  const reservation = createServer();
  reservation.unref();
  await new Promise<void>((resolve, reject) => {
    const rejectListen = (error: Error): void => reject(error);
    reservation.once('error', rejectListen);
    reservation.listen({ exclusive: true, host: LOOPBACK_HOST, port: 0 }, () => {
      reservation.off('error', rejectListen);
      resolve();
    });
  });
  const address = reservation.address();
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  if (address === null || typeof address === 'string') {
    throw new Error('loopback port reservation did not publish a TCP address');
  }
  return address.port;
}
