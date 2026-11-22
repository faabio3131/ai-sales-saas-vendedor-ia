export interface ScheduleScope {tenantId:string;unitId:string}
export interface Shift {day:number;startMinute:number;endMinute:number}
export interface ScheduleProfessional {id:string;name:string;active:boolean;shifts:Shift[]}
export interface ScheduleResource {id:string;name:string;active:boolean;shifts:Shift[]}
export interface ScheduleServiceDefinition {
 id:string;name:string;active:boolean;durationMinutes:number;
 professionalIds:string[];resourceIds:string[];depositMinor:number;
}
export interface ScheduleBlock {id:string;target:'UNIT'|'PROFESSIONAL'|'RESOURCE';targetId?:string;startMs:number;endMs:number}
export interface ScheduleConfig extends ScheduleScope {
 version:number;timezone:string;holdMinutes:number;reminderMinutes:number;
 shifts:Shift[];holidays:string[];professionals:ScheduleProfessional[];
 resources:ScheduleResource[];services:ScheduleServiceDefinition[];blocks:ScheduleBlock[];
 updatedAt:string;updatedBy:string;
}
export type BookingStatus='HELD'|'CONFIRMED'|'CANCELLED'|'EXPIRED'|'COMPLETED';
export type DepositStatus='NOT_REQUIRED'|'UNPAID'|'CREATING'|'PENDING'|'CONFIRMED'|'FAILED'|'REVIEW_REQUIRED'|'REFUNDED';
export interface BookingDeposit {
 amountMinor:number;currency:'BRL';status:DepositStatus;
 provider?:string;providerPaymentId?:string;referenceId?:string;
 pixCode?:string;verifiedAt?:string;
}
export interface BookingReminder {dueMs:number;state:'PENDING'|'READY'|'ACKNOWLEDGED'|'CANCELLED';key:string}
export interface Booking extends ScheduleScope {
 id:string;version:number;configVersion:number;customerId:string;serviceId:string;
 professionalId:string;resourceIds:string[];startMs:number;endMs:number;timezone:string;
 status:BookingStatus;holdUntilMs:number;deposit:BookingDeposit;reminder?:BookingReminder;
 createdAt:string;updatedAt:string;createdBy:string;transitionBy:string;cancelReason?:string;
}
export interface Occupancy extends ScheduleScope {
 id:string;professionalId:string;resourceIds:string[];startMs:number;endMs:number;
 status:'HELD'|'CONFIRMED';holdUntilMs:number;
}
export interface ScheduleSlot {professionalId:string;resourceIds:string[];startAt:string;endAt:string;localTime:string;timezone:string}
export interface RequestReceipt {fingerprint:string;bookingId:string}
export interface ScheduleTransaction {
 config():Promise<ScheduleConfig|null>;
 booking(id:string):Promise<Booking|null>;
 window(startMs:number,endMs:number):Promise<Occupancy[]>;
 records(startMs:number,endMs:number):Promise<Booking[]>;
 future(nowMs:number):Promise<Booking[]>;
 receipt(key:string):Promise<RequestReceipt|null>;
 saveConfig(config:ScheduleConfig):void;
 saveBooking(booking:Booking):void;
 saveReceipt(key:string,receipt:RequestReceipt):void;
}
export interface ScheduleRepository {
 transact<T>(scope:ScheduleScope,work:(tx:ScheduleTransaction)=>Promise<T>):Promise<T>;
}
