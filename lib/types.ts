export interface Coach {
  id: number;
  name: string;
  contact: string;
  hourly_rate: number;
  active: number;
  created_at?: string;
}

export interface Venue {
  id: number;
  name: string;
}

export interface Session {
  id: number;
  coach_id: number;
  venue_id: number;
  recurring: number;
  day_of_week: number | null;
  date: string | null;
  start_time: string;
  end_time: string;
  created_at?: string;
  // joined fields
  coach_name?: string;
  venue_name?: string;
}

export interface SessionInstance {
  id: number;
  session_id: number;
  coach_id: number;
  venue_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: "scheduled" | "completed" | "cancelled";
  hours: number;
  // joined fields
  coach_name?: string;
  venue_name?: string;
}
