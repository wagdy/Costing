// Someone the safe pays advances and salaries to (الموظفين): a name and a job here. While HR is
// linked, they come from HR (hrEmployeeId), with HR's code (the number they punch in with) and
// department; otherwise they are kept here alone. Kept when they leave, as the safe's entries name
// them.
export interface Employee {
  id: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  hrEmployeeId?: string | null;
  code?: string | null;
  department?: string | null;
  branch?: string | null;
}
