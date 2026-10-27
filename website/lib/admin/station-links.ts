/**
 * Admin → review-station hand-off links. Plain module (not 'use client') so server code can
 * call it too. The station runs on the operator's machine from the project folder.
 */
export const STATION_PORT = 4600;

export function stationLinks(orderId: string, jobId: string) {
  return {
    openUrl: `http://localhost:${STATION_PORT}/?order=${encodeURIComponent(orderId)}&job=${encodeURIComponent(jobId)}`,
    startCommand: `npm run station -- ${orderId}`,
  };
}
