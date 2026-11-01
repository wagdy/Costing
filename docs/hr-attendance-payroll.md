# HR, attendance and payroll

HR & Payroll: who is on the payroll, their punches on a ZKTeco attendance device (the K40 Pro),
their days, their advances and their monthly pay. This page is the design; everything on it is
built: the domain, every endpoint below, the ADMS receiver, and the screens.

## The rules

- **Employees** (`hr.Employees`): name, job title, base monthly salary, work schedule start, weekly
  days off, their user number on the device, an optional link to a user account, hired/left
  dates. They are not the system's users: most never sign in to it, but to their own portal.
- **Their profile** (ملف الموظف):
  - Their name is their full name (الاسم بالكامل), as on their ID card: no field apart.
  - National ID (رقم البطاقة): as the company's country writes one (Egypt's card 14 digits,
    Saudi Arabia's ID or Iqama 10 digits starting 1 or 2; see Company Settings), or a
    passport's letters and digits;
    one employee to a card (a unique index). Mobile (رقم الموبايل): 7 to 15 digits, a leading +
    from abroad. Both kept as digits however they are typed: Arabic digits, spaces and dashes
    are fine. Optional, and changed as the rest is: an accountant's change goes to a manager.
  - The ID card's photo or scan (صورة البطاقة): a JPEG, PNG, WebP or PDF of up to 5 MB, checked by
    its first bytes. Its bytes are kept in `hr.EmployeeIdPhotos` (one row an employee, so in the
    backups), apart from the employee, whose row says what it is and who uploaded it when.
    Whoever manages HR uploads, replaces or takes it off, at once: it is not money. Whoever sees
    HR sees it, served with `nosniff`.
  - Nobody is deleted: deactivating someone is their leaving, paid to their last day with every
    record kept, and they can come back.
- **Departments** (الأقسام, `hr.Departments`): every
  employee is in one. General is made with the table, the employees already entered go to it,
  and it is renamed but never deleted. Another is deleted once its employees, those who left
  too, are moved to one that stays, its roles going with them (one the other department has by
  the same name becomes theirs there). A manager's to add, rename and delete.
- **Job roles** (الوظائف, `hr.JobRoles`): each department has its roles,
  one name to a department, and an employee holds one of their own department's, titled by its
  name. The job titles typed before roles were became their departments' roles. A title given
  with no role (the form's new one, or a request asked before roles were) becomes the
  department's role of that name. A role is renamed for everyone holding it, and deleted once
  they take another of the department's.
- **How they are paid** (نوع العمالة): monthly (عمالة شهرية), at a salary, or daily (عمالة يومية), at
  a wage for each day worked.
  - A daily worker's base pay is their wage for each day worked on a working day or a holiday.
    A day not worked, whatever it is, earns nothing and costs nothing: nothing is absent for
    them. A day off worked is paid as anyone's: a day's wage for half a workday or more, its
    hours for less. A holiday worked earns its allowance on top, and lateness and overtime count
    against their work schedule at their hourly rate (the wage ÷ 9), as anyone's.
- **The work schedule is nine hours**, from the employee's work schedule start, past midnight if need be.
- **Flexible hours** (an employee with no work schedule start):
  nothing is late, early or away for them, and the hours past nine worked in a day are overtime.
  Their day runs as the company's workday does (`Company:WorkdayStartsAtHour`, 04:00 to 04:00
  by default), so a night past midnight
  is one day. A working day with no punches is still an absence, and their salary is paid as
  anyone's.
- **Rates come from a 30-day month**, whatever the month's length:
  - a day = salary ÷ 30 (a daily worker's: their wage);
  - an hour = a day ÷ 9;
  - a minute = an hour ÷ 60.
- **A day's punches** are taken from six hours before the work schedule starts to the same time the
  next day, so an evening work schedule that ends after midnight stays one day.
  - They are paired in order (in, out, in, out). The In/Out key pressed on the device is kept
    but not relied on.
  - Two scans within 3 minutes count as one (a setting).
- **Measured against the work schedule:**
  - **late**: from the work schedule's start (the employee's scheduled start) to the first punch,
    unless within the grace (a setting, 0 by default). Past the grace, it counts from the
    work schedule's start, however many hours are worked;
  - **leaving early**: from the last punch to the work schedule's end;
  - **away**: time punched out between pairs while the work schedule ran;
  - **overtime**: time worked after the work schedule's end, once nine hours are worked. Coming in
    early is not overtime, and neither is staying late to make up for coming in late (in at
    10:00 for 08:00, out at 19:00: two hours late, no overtime).
  - So late, early, away and the time worked within the work schedule add up to nine hours.
- **Days:**
  - no punches on a working day is an **absence**, unless a manager marked it as leave or a
    day off;
  - weekly days off are per employee;
  - punches on a day off or on leave are hours worked, with nothing late or overtime, and earn
    a **leave allowance** by themselves: a day's pay for half a workday (4½ hours) or more, the
    hours at the hourly rate for less;
  - a weekly day off worked in exchange for another is marked a **working day** (a swap): a
    normal workday, late and overtime counted, no allowance; the day taken instead is marked a
    day off;
  - a punch-in left **18 hours** without its punch-out is an abandoned work schedule: the day is
    **Suspended**, pending a manager, and its hours are not worked out. A manager resolves it by
    entering the punch-out (after the punch-in, within the day), or by ignoring the stray punch.
    The month's slip cannot be finalized while a day is suspended;
  - a manager can put an **administrative penalty** (جزاء إداري) on a day: hours, with the
    reason, one a day. It is deducted on the payslip at the hourly rate;
  - a **public holiday** (عطلة رسمية, `hr.PublicHolidays`) is
    everyone's paid day off, entered by a manager with its name and days (one to ten: the Eids
    run several). Not worked, it is a holiday whatever the day would have been, never an
    absence. Worked, it is measured as the day would have been (against the work schedule on a working
    day, with lateness, leaving early and overtime; nothing late on a weekly day off) and earns a
    **holiday allowance** by itself, as a day off worked does: a day's pay for half a workday or
    more, the hours for less. On a weekly day off it is paid once, as a holiday. Its lateness
    never takes more than its allowance gives: worked for less than half a workday, it counts no
    more short minutes than it worked, so coming in on a holiday never pays less than staying
    home. A month whose pay is finalized for anyone keeps its holidays.
- **Advances (سلفيات)** are HR's own records (`HrAdvance`): an amount handed to an employee on a
  day, deducted from their pay of the payroll month it names.
  - **Not an expense:** the employee owes it until their payslip deducts it. The wages are
    counted once, at payroll.
  - It counts in the month it is dated, or the next open one when that month's payroll is
    finalized.
- **Incentives (حوافز) and leave allowances (بدل إجازات)** are adjustments to one month's pay,
  entered by a manager (or, later, made by the system), voided rather than changed.
- **The payslip (مسير الرواتب)**, per employee per month:

  ```
  Net = base salary + incentives + leave allowances + days off worked + holidays worked
        + overtime pay − advances − last month's shortfall − lateness − absence
        − administrative penalties
  ```

  - Overtime and lateness (late + early + away) are at the minute rate; an absence costs a
    day's pay.
  - A month started or left part way pays its share of the calendar month.
  - When deductions are more than the pay, nothing is paid and the rest carries to next month.
  - What the month's work cost is `WagesCost`: the pay less what was deducted for time not
    worked. Advances settle a debt, so they are not a cost.
  - A slip is a draft, worked out again as the month changes, until it is finalized. After
    that it does not change.

## Shift rostering (جداول الشفتات)

Restaurant hours move: the roster says, day by day, which shift each employee works or that the day
is off, and the day is measured against that instead of their own work schedule.

- **Shifts** (`Shift`): a name, a start and an end (one ending at or before the hour it starts runs
  past midnight: 22:00 to 06:00 is eight hours), one to sixteen hours, and a colour for the grid.
- **The roster** (`RosterDay`): one per employee per date, a shift or a day off. A date with none
  follows the employee's own schedule (their nine-hour shift and weekly days off), so with no
  roster at all every day is worked out exactly as before.
- **Measured against it** (`WorkSchedule`, `Timesheet`): late from the shift's start (after the
  grace), early before its end, away inside it, overtime past its end once its hours are worked; a
  rostered day off is a day off, never an absence; a rostered shift on a weekly day off is a working
  day. Leave marks win over the roster; a day off (rostered or weekly) marked a working day is
  measured against their own shift. Leave requests count no rostered day off.
- **Which day a punch is of**: a rostered shift's day opens six hours before it starts; a day after
  a shift that ends late opens no sooner than halfway to its own shift's start (three hours after,
  with none), so a night shift's punch-out is never the next morning's punch-in. No shift may start
  before the previous day's ends: the roster refuses it.
- The payroll reads the same days, so lateness, absence and overtime on a rostered day are paid as
  the roster says. A finalized month's days are locked.
- The Shift Rostering section (beside Attendance; its own tab, `HrTabs.Roster`): a week's grid,
  Saturday to Friday, filterable by department; a day's menu or a row's whole week puts days on a
  shift, off, or back to their own schedule; "Repeat last week" copies the week before's rostered
  days. A manager's, or an employee's holding the tab; an accountant holding it sees it. Holding
  Attendance alone gives none of it (the `RosterTab` migration gave it to whoever held Attendance
  when it became a tab of its own).

| Endpoint | What it does |
| --- | --- |
| `GET /api/hr/shifts`, `PUT …/shifts/{id}`, `DELETE …/shifts/{id}` | The shifts; added or changed; deleted only while on no day |
| `GET /api/hr/roster?from=&to=&departmentId=` | Each employee's days, as planned (31 at most; a week from today unless said) |
| `PUT /api/hr/roster` | `changes`: `{ employeeId, date, shiftId, dayOff }`, neither for their own schedule; 500 at most, all or none |

## HR analytics (لوحة التحليلات)

A month, or the three or twelve months to it, of everyone or one department (`GET
/api/hr/analytics?month=&months=&departmentId=`, `GetAnalyticsQuery`). The Analytics section sits
right below Now; it opens on this month, a month back at a time, with 1, 3 or 12 months and a
department filter above it.

- **Attendance & punctuality.** The working days that have passed, up to yesterday: a shift to
  work, the roster's or their own, and not a day off, leave or a public holiday. Each is read as
  the timesheet reads it: on time, late (in after the shift's start and its grace), or absent; a
  suspended day is worked.
  - The attendance rate is the days worked of those, the on-time rate the days on time of those
    worked; late is counted in arrivals and minutes, and overtime is every day's.
  - The trend stacks on time, late and absent by day for a month, by week (Saturday to Friday)
    for three, by month for twelve; a legend and a table view sit beside it, so no colour is read
    alone.
  - The five most late (arrivals, then minutes) and the five most absent.
- **Labour cost by department**, as the payroll works it out each month: contracted, the monthly
  salaries in full; actual, `WagesCost` (the pay earned, prorated base, daily wages, overtime,
  incentives and allowances, less what was deducted for time not worked and penalties). Each
  department's share is of the actual. A bar for the actual, a mark at the contracted.
- **Workforce stability & turnover.** Employed on the period's first day and its last (today, for
  one not over); who joined and who left in it; the turnover rate, those who left over the
  average of the two, in percent; and the average tenure of those employed at the end.
- **Who sees it.** Its own tab (`HrTabs.Analytics`): a manager's, an accountant's (every tab until
  ticked; the `AnalyticsTab` migration gave it to accountants whose tabs were ticked already), and
  an employee's a manager gives it to. The labour costs come back null without the Payroll,
  Employees or Departments tab, and the page says why.

## The domain

`backend/src/Costing.Domain`, referencing nothing but .NET. Tables are in the `hr` schema, the
system's users in `identity`; one migration, `InitialCreate`.

| Type | Table | What it is |
| --- | --- | --- |
| `Employee` | `hr.Employees` | Someone on the payroll, with their rates |
| `AttendanceDevice` | `hr.AttendanceDevices` | A K40 Pro known by its serial number, approved by a manager |
| `AttendanceLog` | `hr.AttendanceLogs` | One raw punch, from a device or by hand; ignored, never removed |
| `DayMark` | `hr.DayMarks` | A manager's "leave" or "day off" for one day |
| `Timesheet`, `DailyRecord` | `hr.DailyRecords` | A day's hours, lateness and overtime, worked out from its punches; kept as a finalized slip counted it |
| `PayrollAdjustment` | `hr.PayrollAdjustments` | An incentive or a leave allowance for a month |
| `PayrollCalculator`, `PayrollSlip` | `hr.PayrollSlips` | A month's payslip and every figure in it |
| `HrSettings` | `hr.Settings` | The grace, and how close two scans are to be one |
| `HrAdvance` | `hr.HrAdvances` | An advance: to an employee, or to no one yet (a lump sum given out a share each) |
| `AdvanceAllocation` | `hr.AdvanceAllocations` | An employee's share of a lump sum, deducted from their pay of a month |
| `SalaryPayment` | `hr.SalaryPayments` | What was paid of a finalized slip, on a day; voided rather than changed |

Punch times are the device's wall clock, stored as `timestamp without time zone`. A punch sent
twice is kept once: it is unique by device, user number and time.

## Receiving the device's punches: ADMS

The K40 Pro pushes to us over HTTP with ZKTeco's ADMS ("iclock") protocol. Nothing Windows-only
(no `zkemkeeper.dll`, no COM) is needed. The API answers it at these paths, outside
`/api` because the device's paths are fixed:

| Request | When | Our answer |
| --- | --- | --- |
| `GET /iclock/cdata?SN=…&options=all` | The device starts or reconnects | Its options, text/plain: `GET OPTION FROM: <SN>`, `ATTLOGStamp=<last stamp>`, `OPERLOGStamp=9999`, `ErrorDelay=30`, `Delay=10`, `TransTimes=00:00;14:05`, `TransInterval=1`, `TransFlag=TransData AttLog OpLog`, `Realtime=1`, `Encrypt=None` |
| `POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…` | New punches, or all those it kept while the server was away | Each line `PIN⇥YYYY-MM-DD HH:MM:SS⇥status⇥verify⇥…` becomes an `AttendanceLog`, any number of them, saved a thousand at a time (up to 16 MB a request). Answer `OK:<lines>`, then keep the stamp |
| `POST /iclock/cdata?SN=…&table=USERINFO` (or `OPERLOG`) | Its users, when asked | `PIN=…⇥Name=…` (or `USER PIN=…⇥Name=…`) lines keep the user's number and name (`DeviceUser`), nothing else: no password or card. Fingerprint and face templates (`FP …`, `FACE …`, `BIODATA …`) are never stored |
| `GET /iclock/getrequest?SN=…` | Every few seconds | `OK`, or the oldest command a manager left for it, `C:<n>:DATA QUERY USERINFO` or `C:<n>:DATA QUERY ATTLOG StartTime=…⇥EndTime=…` (`DeviceCommand`), handed over once |
| `POST /iclock/devicecmd?SN=…` | A command's result | `ID=<n>&Return=<code>&CMD=…`: the command answered, 0 being done; `OK` |

The exact option set and command syntax vary by firmware. They are to be checked against our
unit with a capture of its first requests before they are fixed. A command the firmware does not
take comes back with a non-zero code, shown on the Devices tab.

**Syncing what the device held before the system:**
- Its attendance: on approval the server's options say `ATTLOGStamp=None`, so the device sends
  its whole stored log by itself. A manager can also have it read again from one day to another
  (`DATA QUERY ATTLOG`); what is kept already is kept once. Punches from before an employee's
  hire date count for nothing.
- Its users: a manager has it list them (`DATA QUERY USERINFO`). Each user nobody in the system has
  the number of is listed on the Employees tab, with the punches waiting under it, to add as an
  employee (name and number filled in) or link to one; their punches are theirs from then.

**Offline, and late punches:** the device keeps its punches while the server is off the
network and sends them all when it is back. The days are worked out from the punches' own
times, so past days come out as if the punches had arrived on time, and a punch sent twice is
kept once. One that arrives for a month whose pay is finalized is kept, the slip stays as it was,
and Corrections lists it until a manager marks it seen to (settling in a later month's pay what
it changes).

**What happens to a punch:**
1. The line is parsed strictly. A malformed one is logged and skipped, never the whole batch.
2. The user number is looked up to an employee. A number nobody has is kept, waiting, and
   counted once linked.
3. The punch is inserted unless already there (the unique index).
4. The device's stamp and last-seen time are updated.
5. The days are worked out from the punches whenever they are read (`Timesheet.Evaluate`).
   So a punch arriving, one entered or ignored, a day marked, a work schedule moved or the grace changed
   shows at once, with nothing stored to fall out of step. A month's days are kept
   (`DailyRecord`) when its slip is finalized: what the pay was worked out from.
6. A day is absent once it is over (its window has closed) with no punches on a working day.

**Security.** The device names itself only by its serial number, over plain HTTP, with no key:
- The `/iclock` endpoints are anonymous, as the device cannot sign in. The check is the serial
  number: a device first seen is recorded as waiting and refused (403), and nothing it sends
  is taken until a manager approves it by name. The device keeps its own log and sends
  everything after its stamp once approved, so nothing is lost.
- Requests are size-limited and rate-limited per serial number. A punch far from the current
  time (a device whose clock was reset) is kept but flagged.
- **Address checks behind Docker or a proxy are unreliable**: port forwarding can make every
  connection appear to come from its own gateway, not the device's real address. The serial
  number and the network's own separation are what protect it.
- Anyone on the office network who reads the serial off the device's label could post punches.
  Keep guest Wi-Fi off that network, and the server's port off the internet. Punches are raw
  evidence a manager reviews, with manual corrections recorded by name and reason.

**Network.**
- The API listens on its `Urls` (port 5090 unless configured). The device reaches the same port
  and app as the browsers do, unless it has a port of its own.
- Give the server a fixed address (a DHCP reservation on the router), and allow incoming
  connections to its port in the firewall.
- **The device's own port** (`Attendance:DevicePort`): when set, the API answers nothing but the
  device's `/iclock` paths on it, so the screens stay off that port. In development the API
  listens on `localhost:5090` for the screens and on `0.0.0.0:5092` for the device (and
  `0.0.0.0:5093` for the portal). `GET /api/hr/devices/connection` gives the device's port (or
  the API's own when none is set), the server's addresses, and whether the API listens there for
  the network; the Devices and Now tabs show the address and port to enter, this machine's
  network address when the screen is open on it, and say plainly when the device could not reach
  the port (the API listening on this machine alone). Unset, every port answers everything.
- On the device: Main Menu → COMM. → Cloud Server Setting.
  - Server mode ADMS, Enable Domain Name off.
  - Server Address = the server's address, Server Port = the API's port (or the device port).
  - Proxy off, HTTPS off.
  - Menu names vary by firmware.
- If the server sleeps or is down, the device holds its punches and sends them when it
  reconnects.

**Calling in.** A device calling over ADMS asks for commands every few seconds, and its last
call is kept apart from when the server last read it (`LastCalledInAtUtc`). Quiet for three
minutes, it is not reaching the server: its punches come only when someone presses Sync. A
device added by a Sync has never called in until it is pointed at the server.

**Its clock.** A device sets its clock from the time of the server's answer (UTC) and a time zone:
left to its own, +8 as ZKTeco ships it, its punches run hours ahead, and count on the wrong day
(the K40 did, five hours fast, on 2026-10-22). The server sends the company's zone
(`Company:TimeZoneId`) as it starts
(`TimeZone=` in the options, whole hours, or minutes for a zone on the half hour), so it sets its
clock right each time it starts; a change of daylight saving reaches it at its next start. A
device whose last punch (ignored ones aside) came stamped more than ten minutes ahead of its
arrival is said to have a fast clock, on Now and the Devices tab, until a punch comes right or
those punches are ignored. A slow clock cannot be told from punches kept while it was away.

## Reaching the device on its own port: TCP 4370

Beside ADMS, the server can reach the device itself over ZKTeco's binary protocol on TCP port
4370. Nothing Windows-only is used: `ZkClient` (in `Costing.Infrastructure/Hr/ZkTeco`) follows the
open-source pyzk client packet for packet.
- **Its frames:** `50 50 82 7D`, the length, then command, checksum, session and reply number.
- **A comm key**, when one is set on the device (COMM. → Comm Key), is sent as pyzk makes it.
- **Large answers:** the user table and the attendance log come through the device's buffer, in
  chunks of up to 0xFFC0 bytes.
- **Record sizes:** 72-byte users and 40-byte punches on the K40, or the older 28 and 16.
- **What is kept:** a user's number and name only, never passwords, cards or fingerprints.

Two buttons on the Devices tab (Connection settings · إعدادات التوصيل, a manager's), given the
device's IP address, port 4370 unless said otherwise, and its comm key (0 for none):
- **Test connection** connects, then reads the serial number, model, firmware and how many
  users and punches it holds. When it fails, it says why: nothing listening on the port, no
  answer, a closed connection, or a refused comm key.
- **Sync device** reads the users and the whole log at once and keeps them as ADMS does:
  - punches are kept once each, so a sync after ADMS, or ADMS after a sync, keeps nothing twice;
  - users are listed on Employees for linking;
  - a device read for the first time is approved by it, as a manager gave its address and asked;
  - a clash with an ADMS upload of the same punches is read again.
- **Only local addresses** are accepted: IPv4 in the private ranges, link-local or loopback.
  The server does not reach further than the local network.
- **Timeouts:** each answer is waited on for 5 seconds on a test and 20 on a sync, so a device
  that stops answering is let go.

ADMS goes on as before; this is for a device whose Cloud Server Setting is off or missing, and
for reading everything now.

## Excel

ClosedXML, in `Costing.Infrastructure/Excel`
(`EmployeeWorkbook`, `PayrollWorkbook`); what a row becomes is `ImportEmployeesCommand`'s.
- **The template:** Name, Employment Type, Base Salary, Department, Job Role, Work Schedule Start, Days
  Off, Hired On and Device No., each headed in English and Arabic. Dropdowns list monthly or
  daily, the departments and the roles; a sheet says how to fill it, with examples.
- **Reading a sheet:** columns are found by heading, in either language and in any order. It
  takes times as cells or typed ("10:00", "4 PM", "٤ م"), and Flexible (مرن) for flexible hours.
  Days off are English or Arabic ("الجمعة والسبت"). Dates are cells, ISO or day first
  ("1/10/2026"), and Arabic digits are read too.
- **What a row becomes:**
  - a department not in the system is added (a manager's import only: anyone else's row waits for
    a manager to add it), and a role not in its department is made;
  - a name or device number already in the system, asked for, or earlier on the sheet is skipped,
    so a sheet imported twice adds no one twice;
  - a manager's rows are added at once; anyone else's are each a request a manager approves.
- **The export** is in the template's columns, so it can be added to and imported again (those in
  the system are skipped). The payroll export is for the accounts: a title, each slip's columns as
  the Payroll tab shows them, and a totals row of sums.

## The API

**Who:** the system's users sign in with an email and a password (`POST /api/auth/sign-in`), as
a Manager or an Accountant; the first manager comes from `Auth:FirstManager`, and a manager adds
the rest on Users (`/api/users`). Employees sign in to their portal with their mobile number and
PIN instead.
- `hr.view` sees HR and salaries; `hr.manage` enters employees, advances and assets;
  `approval.decide` decides requests and does what only a manager does; `users.manage` keeps
  the users.
- Managers have all four; accountants `hr.view` and `hr.manage`, in the tabs a manager gives them.
- An accountant's employee changes, advances and custody changes are requests a manager approves
  (`/api/approval-requests`, modules `Employee`, `Advance` and `Custody`).
- Correcting attendance, the devices and their settings, incentives and allowances, finalizing
  pay and paying it are a manager's (or an employee's holding the tab, see Employee
  permissions).

**Endpoints:**

| Endpoint | What it does |
| --- | --- |
| `GET /api/hr/employees` | The employees, left ones too |
| `GET /api/hr/employees/{id}` | One employee, left or not: their profile (404 when there is none) |
| `PUT /api/hr/employees/{id}/id-photo` | Their ID card's photo or scan (multipart `file`, JPEG, PNG, WebP or PDF, 5 MB at most), replacing the one there was: whoever manages HR |
| `GET /api/hr/employees/{id}/id-photo` | The card's file (`?download=true` to save it under its name): whoever sees HR |
| `DELETE /api/hr/employees/{id}/id-photo` | The card's file taken off: whoever manages HR |
| `PUT /api/hr/employees/{id}` | Add or change an employee: 200 for a manager, 202 (a request) for anyone else |
| `POST /api/hr/employees/{id}/leave`, `…/return` | Leave on a last day; come back from a day |
| `GET /api/hr/employees/template` | The Excel template to bring employees in from, with the departments and roles as dropdowns: whoever manages HR |
| `POST /api/hr/employees/import` | A filled-in sheet (multipart `file`, 5 MB at most): each good row an employee, a manager's at once and anyone else's a request; the rows skipped and why, and the departments added |
| `GET /api/hr/employees/export` | Everyone employed now as a styled Excel table, in the template's columns plus their day and hour rates |
| `GET /api/hr/payroll/export?month=` | The month's payroll as an Excel sheet: each slip's columns as the Payroll tab shows them, its status and what is paid, with the totals |
| `GET /api/hr/attendance?date=` | Everyone's day, plus punches under numbers nobody has; each day says whether they forgot to check out, and the totals count them |
| `GET /api/hr/employees/{id}/timesheet?month=` | One employee's month, day by day, with totals |
| `POST /api/hr/punches`, `…/{id}/ignore`, `…/{id}/restore` | A manual punch with its reason; ignoring or restoring one |
| `PUT /api/hr/employees/{id}/days/{date}` | Leave, day off or working day (a swap); with no kind, the mark taken off |
| `GET /api/hr/attendance/suspended?from=&to=` | The suspended days, everyone's: the corrections dashboard |
| `POST /api/hr/attendance/resolve` | A suspended day's punch-out, from a manager: the day worked out again |
| `PUT /api/hr/employees/{id}/days/{date}/penalty` | An administrative penalty in hours, with the reason; with no hours, taken off |
| `GET /api/hr/penalties?month=` | The month's administrative penalties, everyone's, each with what it takes off the pay |
| `GET /api/hr/departments`, `PUT …/{id}`, `DELETE …/{id}?moveTo=` | The departments with how many are in each and their roles, and what each costs (monthly salaries and daily wages apart, of those employed now); added or renamed, or deleted with its employees moved first: a manager's |
| `PUT /api/hr/departments/{id}/roles/{roleId}`, `DELETE /api/hr/roles/{roleId}?moveTo=` | A department's role added or renamed, or deleted with its holders moved to another: a manager's |
| `GET /api/hr/devices/connection` | Where a device reaches the server: the device's own port, when set, and the machine's addresses |
| `POST /api/hr/devices/test`, `…/sync` | The server reaching the device at `{ address, port = 4370, commKey = 0 }`: whether it answers and what it holds, or its users and whole log read and kept (approved if new): a manager's |
| `GET /api/hr/attendance/now` | Who is in now: each employee on the day their own window puts now in, in (an odd number of scans), left (even), not arrived, late (their work schedule and its grace started) or off. As punches come or a day is put right, the hub (`/hubs/hr`) sends `EmployeeStatusChanged` to whoever sees HR: each employee it touched, with their day, state, since when, when due, and the time it was worked out |
| `GET /api/hr/holidays?year=` | A year's public holidays |
| `POST /api/hr/devices/{id}/read-users`, `…/read-attendance` | A command left for the device: list its users, or send its attendance from a day to another again: a manager's |
| `GET /api/hr/device-users` | The users the devices listed, who in the system has each number, and the punches waiting under it |
| `GET /api/hr/attendance/late-punches`, `POST …/settle` | Device punches that came after their month's pay was finalized; marked seen to by a manager |
| `PUT /api/hr/holidays/{id}`, `DELETE …/{id}` | A public holiday added or changed, or taken off: a manager's |
| `GET`/`PUT /api/hr/settings` | The grace, and how close two scans are to be one |
| `GET /api/hr/devices`, `POST …/{id}/approve`, `…/revoke` | The devices, approved by name |
| `GET /api/hr/advances?month=` | The month's advances, each deducted from whose pay (paid to them, or their share of a lump sum); and the advances handed out with no one named, every one not all given out: how much, given out, left, and the shares |
| `POST /api/hr/advances`, `POST /api/hr/advances/{id}/void` | An advance (`{ advanceId, amount, date, employeeId?, notes }`): a manager's at once, anyone else's a request (module `Advance`); voided by a manager while its pay is not finalized, a lump sum once no share of it stands |
| `POST /api/hr/advances/{id}/distribute`, `POST /api/hr/advance-shares/{id}/take-back` | A lump sum given out, a share each (`{ shares: [{ employeeId, amount, notes }] }`), in parts and never more than is left; a share taken back while its pay is not finalized: a manager's |
| `GET /api/hr/payroll?month=` | Every slip as it stands, with the month's totals: its total salaries (gross) and administrative penalties among them |
| `GET /api/hr/payroll/daily-cost?date=` | A day's labour cost: who punched in, each at their day's rate, by department, the day's overtime pay beside it |
| `POST /api/hr/payroll/calculate?month=` | Saves the drafts |
| `POST /api/hr/payroll/{employeeId}/finalize?month=` | Finalizes one slip |
| `POST /api/hr/payroll/adjustments`, `…/{id}/void` | Incentives and leave allowances |
| `POST /api/hr/payroll/payments`, `…/payments/{id}/void` | A finalized slip paid, in full or in part (`{ paymentId, employeeId, month, date, amount, notes }`), never more than it still owes; a payment entered by mistake voided |
| `GET /api/approval-requests?decided=`, `POST …/{id}/approve`, `…/{id}/reject` | What waits for a manager, and the last decisions; approved or rejected with a note: a manager's |
| `GET /api/users`, `POST /api/users`, `PUT …/{id}`, `PUT …/{id}/password` | The system's users: added with a first password, changed or deactivated, a new password set (which signs them out and lifts a lockout): a manager's |
| `GET /api/auth/me`, `POST /api/auth/password` | Who is signed in and what they may do; their own password changed with the one they have now |

**Advances and salary payments,** HR's own records:
- An advance (`HrAdvance`) is entered on HR → Advances → New advance: an amount on a day, to an
  employee or to no one yet. A manager's is recorded at once, anyone else's waits for a manager.
- Paid to an employee, it comes off their pay of its month (or the first after it whose pay is
  not finalized for them), and shows on their payslip.
- An advance deducted by a finalized slip cannot be voided. One dated after its month's slip is
  finalized counts in the next month.
- A finalized slip is paid by salary payments (`SalaryPayment`): all that is owed at once, or
  part of it now and the rest later, never more than it still owes. A payment entered by
  mistake is voided, and owed again.

**Advances handed out with no one named (السلفيات المعلقة):**
- An advance may name no employee: a lump sum handed out, to give out later.
- It waits on HR's Advances (`GET /api/hr/advances`). A manager gives it out to employees, a share
  each (`AdvanceAllocation`): in parts if need be, and never more than is left. It is fully
  allocated once the shares add up to it.
- Each share is deducted from its employee's pay as their own advance would be: from the month the
  money was handed out, or the first after it whose pay is not finalized for them. It shows on
  their payslip as a share of that day's advances.
- A share is taken back while that pay is not finalized. The lump sum is voided only once no share
  of it stands.
- **Screens:**
  - The employee is chosen by typing part of their name or job (`EmployeePicker`). "No one yet"
    makes the advance a lump sum.
  - HR → Advances (السلفيات) has two views. Pending (وضع معلق) shows each lump sum: what is given
    out and what is left, and its shares, each taken back by a manager. Allocated shows the
    month's advances off whose pay: an advance to them, or a share.
  - A manager's Distribute dialog has a row an employee, offered only those employed on its day
    and each once. Split equally shares what is left in whole units, the odd ones on the first.
    It never gives out more than is left, and some may stay for later.

A day off worked earns its leave allowance by itself (the slip's `DaysOffWorkedPay`), and a public
holiday worked its holiday allowance (`HolidaysWorkedPay`); leave allowances entered by a manager
are for anything else.

## Employee permissions (صلاحيات الموظفين)

Each tab of HR & Payroll is given on its own: Now, Analytics, Employees, Departments, Attendance,
Shift Rostering, Corrections, Payroll, Advances, Holidays and Devices, and Custody & Assets beside them
(`HrTabs`, a bit each).

The Permissions page lists only those holding any: each employee given tabs, and each
accountant (every tab until ticked). "Add permission" picks someone from everyone, searched by
name, then their tabs, each with what it lets them do; a row changes them, or takes them all off.

- **Who holds which.** A manager holds every tab, always, and alone gives them (the
  Permissions tab, `GET /api/hr/access`, `PUT …/access/employees/{id}`,
  `PUT …/access/staff/{userId}` for an accountant).
  - An employee holds none until given some (`Employee.HrTabs`, stored by name). They work
    theirs in the portal, on their phone: `/hr` there is HR & Payroll's own screens, only their
    tabs, under the portal's bar.
  - An accountant holds every tab until a manager ticks theirs (`hr.StaffHrAccess`, by the
    user's id).
- **What a tab lets them do.**
  - Someone's record, an advance or an asset: a change goes to a manager to approve, from an
    employee as from an accountant.
  - What only a manager does otherwise (punches put right, days marked, suspended days,
    penalties, departments and roles, holidays, the devices and their settings, incentives
    and allowances, finalizing a month, giving out and voiding advances, custody categories):
    an employee holding the tab does it at once, as a manager would (`[HrTab(..., Decide =
    true)]`). An accountant does not: that stays a manager's for them.
  - PINs, who holds which tab, and the users stay a manager's alone.
- **The token.** An employee's portal token names their tabs (`hr_tabs`), which the portal reads
  for its tabs. Every request checks them against the ones they have now, as it checks their
  PIN: a change of tabs signs them out, and they sign in again to see the new ones.
- **The API.** Each HR and Custody endpoint says its tabs (`[HrTab(...)]`; a test keeps every
  one saying so). The portal's port answers `/hr`, `/custody`, `/api/hr`, `/api/custody`,
  `/api/leaves` and `/api/performance` too, and only an employee's token holds a tab there: a
  user's, carried over the Wi-Fi, holds none.
- **What is never sent.** These come back as null to whoever lacks the tab that shows them:
  - what anyone earns, their national ID, mobile and ID card, without the Employees or Payroll
    tab (Attendance has the names and work schedules, not the pay);
  - a department's costs, and the analytics' labour costs, without Departments, Employees or
    Payroll;
  - what an asset cost, to an employee, always: Custody's screens show them none, and an asset
    they change keeps its cost when they send none.
- **The screens.** Only the tabs held show, and a typed address opens only those (the first one
  held otherwise). A link to another tab (an employee's month from Corrections, the timesheet
  from a payslip) shows only to whoever holds that tab; the profile's payslip is the Payroll
  tab's.

## The screens

- **Sign-in** with an email and a password; **Users** (a manager's) to add, change, deactivate
  and set a new password for the system's users; **Approvals** (a manager's) for what
  accountants asked, counted in the top bar; and **Your account** to change one's own password.
- HR & Payroll in the top bar for whoever holds a tab of it, opening on the first one they hold, Now (الآن): who is in right
  now, by department, green in since their last scan, grey left, yellow not arrived yet, red
  late, and off today; with the counts, and what waits on Corrections. A pushed card changes in
  place, lit up for a moment, without the page being read again; the whole page is read every
  minute for the clock, and after the connection was lost. Each card opens the employee's month.
  When an approved device has not called in over ADMS for three minutes, the page says so (its
  punches then come only with Sync) and where to point it; the Devices tab says it of each.
  - Employees, in two lists one at a time (a switch at the top, each side with its count; the
    second kept in the address as `?view=device`): System employees (الموظفين العاملين), and
    Device users (مسجلين على جهاز البصمة), the device's users nobody in the system has the number of
    yet, each leaving it once added or linked. Show who has left and Department filter the
    first; Excel, Sync device and Add employee are above both;
  - Employees: add, change, leave and come back; an accountant's go to a manager; a row (or the
    name) opens the employee's profile;
  - An employee's profile (`/hr/employees/{id}`): their personal details (full name, national
    ID, mobile, start), their work and pay, and their ID card shown (a photo as it is, a PDF in
    the browser's viewer, larger on View larger) with Upload, Replace and Take off; Edit opens
    the Employees form, Deactivate their leaving, Bring back their return, all locked while a
    change waits for a manager; beside them (below on a narrow screen), their payslip for the
    current month, a month back at a time, as Payroll has it (incentives, finalizing and paying
    included), printing alone;
  - Device users: add each as an employee, or link their number to one already here;
    the form takes the department, a role of it (picked, or a new one typed), monthly or daily
    pay, and flexible hours (no start time); the list shows each one's department, filters by
    one, and a daily worker's wage a day; Sync device reads each device directly over TCP 4370
    (at the address last used in this browser, with its port and comm key, and where each
    approved device last called from), its users listed and its new punches kept; an approved
    device not read that way (its port closed while it uses ADMS, or no address known) is asked
    for its users over ADMS instead, and the list read again as they come;
  - Employees' Excel menu: Download template (تحميل القالب), Import Excel (رفع إكسيل) and
    Export employees (تصدير الموظفين); what an import did shown row by row;
  - Departments, as a table of what they cost: each department, its roles a row each (and one
    for those holding none) with how many hold it and what they cost, then the department's
    total and its share of the salaries, and all of them at the foot; monthly salaries and daily
    wages said apart, a daily worker's month being the days they work; added, renamed, and
    deleted with its employees (or a role's holders) moved first; General kept;
  - Attendance devices: where to point the K40, approve or refuse it, have it list its users or
    send its attendance again (the command's progress shown as it goes), and the grace and
    double-scan settings. Connection settings (إعدادات التوصيل) above the list: the device's IP
    address, port and comm key (as last used in this browser, remembered once a test or sync
    reaches the device; else the address it last called from), with
    Test connection and Sync device over TCP 4370, each with progress, a message at the bottom
    and the outcome under the buttons.
  - Corrections also lists the punches that came after their month's pay was finalized, a day at
    a time, until a manager marks them seen to.
- Payroll's Export Excel (تصدير إكسيل): the month as a sheet for the accounts.
- Payroll in two views (`?view=daily` for the second): the month's, its Total salaries (إجمالي
  الرواتب, before anything is deducted) first among the figures, and lateness, absence and
  administrative penalties together as Deductions & penalties (خصومات وجزاءات) just before Net
  payable, each slip's parts under its amount; and Daily cost (تكلفة يوم): a day chosen (today so
  far, or one before it), who came in at their day's rate (a monthly salary over 30, or the
  daily wage), the total and each department's with its share, and the day's overtime beside it,
  not in the total.

- Attendance: the day's review (مراجعة يوم), everyone's in, out and status on a day, or one
  employee's month.
  - Forgot to check out (نسي تسجيل الانصراف): a punch-in with no punch-out once the work schedule is over
    (flexible hours, or a day off: once the day is), its row lit and its Out said so, counted
    at the top, where a click shows only them. A suspended day is one too; the 18-hour rule for
    the pay stays.
  - Each day opens to its punches.
  - A manager adds a missed punch with its reason, ignores one that should not count, marks
    a day as leave or a day off, enters a suspended day's punch-out, or gives the day an
    administrative penalty.
  - Punches under a number nobody has are listed under the day.
- Corrections (مراجعة وجزاءات), its tab counting the days waiting:
  - the suspended days since the first of last month (or a day chosen), each with its punches
    and the stray punch-in marked; a manager enters the punch-out (after the punch-in, within
    18 hours of it and before the next day starts; the work schedule's end a click away) or ignores the
    stray punch;
  - the month's administrative penalties, with what each takes off and the total; a manager
    adds one for whoever is employed in the month (told when it replaces the day's own), and
    changes or takes one off.
  - Accountants see both, with nothing to change.
- Holidays (العطلات الرسمية), a year at a time: the holidays entered, each changed or taken off
  by a manager; and the fixed-date holidays of the company's country not entered yet (Egypt's
  seven fixed dates and Sham El-Nessim, the Monday after Coptic Easter; Saudi Arabia's Founding
  Day and National Day), each added once checked against the official announcement. The holidays
  that follow the moon (the Eids among them) are added once announced. Attendance names the holiday on its days, and the payroll and
  payslip show the holidays worked.
- Payroll: the month's slips, each part of the formula a column, with totals.
  - Calculate drafts saves them.
  - Each row opens the employee's payslip: the formula line by line from base salary to net
    payable, the days it came from, incentives and allowances (a manager adds and voids them),
    advances, and the salary paid of it.
  - Finalize (a manager's, once the month is over and no day is suspended; the payslip points
    to Corrections when one is), then Pay salary: what is owed, or part of it, on a day, with
    notes; a payment entered by mistake is voided.
  - It prints as a payslip.
