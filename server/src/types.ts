export const BOOKING_STATUSES = [
  'new',
  'contacted',
  'confirmed',
  'completed',
  'cancelled'
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const MEDICAL_CATEGORY_IDS = new Set(['cosmetology', 'traumatology']);

export interface AdminBooking {
  id: number;
  name: string;
  phone: string;
  serviceCategory: string | null;
  service: string | null;
  preferredDate: string | null;
  comment: string | null;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BookingCounts {
  total: number;
  new: number;
}

export interface BookingListResult {
  items: AdminBooking[];
  nextBeforeId: number | null;
  counts: BookingCounts;
}

export interface BookingEvent {
  type: 'booking.created' | 'booking.updated' | 'booking.deleted';
  booking?: AdminBooking;
  id?: number;
}

export interface AdminUser {
  id: number;
  username: string;
}
