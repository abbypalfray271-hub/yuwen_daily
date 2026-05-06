export interface UserStats {
  nickname: string;
  grade: number;
  contact: string;
  pin: string;
  checkInStreak: number;
  lastCheckInDate: string;
  totalCheckInDays: number;
  masteredTools: string[];
  expiryAt?: string;
}

export interface Progress {
  dayId: string;
  masteredData: any;
}
