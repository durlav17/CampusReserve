// Shapes returned by the CampusReserve API (camelCased Oracle columns).

export type RoleCode = 'STUDENT' | 'FACULTY' | 'COORDINATOR' | 'ADMIN';
export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ResourceStatus = 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED';
export type MaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface User {
  userId: number;
  fullName: string;
  email: string;
  regNo: string | null;
  phone: string | null;
  role: { id: number; code: RoleCode; name: string };
  canApprove: boolean;
  canAdminister: boolean;
  department: { id: number; code: string; name: string };
  createdAt: string;
  lastLoginAt: string | null;
  isActive?: 'Y' | 'N';
  bookingCount?: number;
}

export interface Department { deptId: number; deptCode: string; deptName: string; userCount: number; resourceCount: number }
export interface Building { buildingId: number; buildingCode: string; buildingName: string; campusZone: string | null; floors: number; resourceCount: number }
export interface Category { categoryId: number; categoryCode: string; categoryName: string; requiresApproval: 'Y' | 'N'; maxBookingHours: number; minNoticeHours: number }

export interface Resource {
  resourceId: number;
  resourceCode: string;
  resourceName: string;
  status: ResourceStatus;
  capacity: number;
  floorNo: number | null;
  roomNo: string | null;
  opensAtHour: number;
  closesAtHour: number;
  description: string | null;
  features: Record<string, unknown> | null;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  requiresApproval: 'Y' | 'N';
  maxBookingHours: number;
  minNoticeHours: number;
  buildingId: number | null;
  buildingCode: string | null;
  buildingName: string | null;
  campusZone: string | null;
  deptId: number;
  managedByDeptCode: string;
  managedByDeptName: string;
  openMaintenance: number;
  isBookable: 'Y' | 'N';
}

export interface ResourceDetail extends Resource {
  utilisation30d: number;
  upcoming: { bookingId: number; title: string; status: BookingStatus; startTime: string; endTime: string; requesterName: string }[];
  openTickets: { requestId: number; title: string; priority: Priority; status: MaintStatus; createdAt: string }[];
}

export interface Booking {
  bookingId: number;
  title: string;
  purpose: string | null;
  attendees: number;
  status: BookingStatus;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  durationHours: number;
  resourceId: number;
  resourceCode: string;
  resourceName: string;
  capacity: number;
  categoryCode: string;
  categoryName: string;
  requiresApproval: 'Y' | 'N';
  buildingCode: string | null;
  buildingName: string | null;
  requesterId: number;
  requesterName: string;
  requesterEmail: string;
  requesterDeptCode: string;
  requesterRole: RoleCode;
  decision: 'APPROVED' | 'REJECTED' | null;
  decisionRemarks: string | null;
  decidedAt: string | null;
  approverName: string | null;
  hoursWaiting?: number;
  competingRequests?: number;
  history?: AuditEntry[];
}

export interface AuditEntry {
  auditId: number;
  tableName?: string;
  recordId?: number;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  oldStatus: string | null;
  newStatus: string | null;
  changedAt: string;
  details: string | null;
  changedByName: string | null;
}

export interface Maintenance {
  requestId: number;
  title: string;
  description: string | null;
  priority: Priority;
  status: MaintStatus;
  blocksBooking: 'Y' | 'N';
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  ageDays: number;
  resourceId: number;
  resourceCode: string;
  resourceName: string;
  resourceStatus: ResourceStatus;
  reporterId: number;
  reporterName: string;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface Slot { slotStart: string; slotEnd: string; slotState: 'FREE' | 'BOOKED' | 'PENDING' | 'BLACKOUT' | 'PAST' | 'CLOSED'; bookingId: number | null }
export interface ScheduleEntry { entryKind: 'BOOKING' | 'BLACKOUT'; entryId: number; title: string; entryStatus: string; startTime: string; endTime: string; requesterName: string | null; requesterId: number | null }
export interface Notification { notificationId: number; notifType: string; title: string; message: string; bookingId: number | null; isRead: 'Y' | 'N'; createdAt: string }

export interface Summary {
  totalResources: number; availableResources: number; resourcesInMaintenance: number; activeNow: number;
  upcomingApproved: number; pendingApprovals: number; openMaintenance: number; bookingsToday: number; avgUtilisation30d: number | null;
}
export interface Paged<T> { total: number; items: T[] }
