import { EventEmitter } from 'node:events';
import type { BookingEvent } from '../types.js';

/**
 * In-process event bus. The app runs as a single instance, so this is enough
 * for real-time updates without an external broker.
 */
export const bookingEvents = new EventEmitter();

bookingEvents.setMaxListeners(50);

export function emitBookingEvent(event: BookingEvent): void {
  bookingEvents.emit('booking', event);
}
