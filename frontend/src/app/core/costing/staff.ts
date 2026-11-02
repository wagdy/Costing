// Someone the safe pays advances and salaries to (الموظفين): only a name and a job here, the
// people themselves being an HR system's. Kept when they leave, as the safe's entries name them.
export interface Employee {
  id: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
}
