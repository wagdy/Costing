using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddHrIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PayrollRunId",
                schema: "costing",
                table: "SafeTransactions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "HrLinks",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    BaseUrl = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    HrKeyProtected = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    HrKeyHint = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    KeyHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    KeyHint = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    KeyCreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    KeyCreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    EmployeesSyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EmployeesSynced = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HrLinks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HrOutbox",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Action = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    Payload = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastError = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HrOutbox", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HrSyncLogs",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Direction = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Call = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Outcome = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Reference = table.Column<Guid>(type: "uuid", nullable: true),
                    Detail = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HrSyncLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PayrollRuns",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<DateOnly>(type: "date", nullable: false),
                    Employees = table.Column<int>(type: "integer", nullable: false),
                    TotalGrossWages = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalAdditions = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalPenalties = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalAdvancesDeducted = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalBroughtForward = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NetCashPayable = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    LaborCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ReceivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SafeTransactionId = table.Column<Guid>(type: "uuid", nullable: true),
                    DisbursedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DisbursedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollRuns", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StaffDeductions",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    RecordedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RecordedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffDeductions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StaffDeductions_Staff_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "costing",
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SyncedEmployees",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    HrEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffMemberId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Department = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Branch = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncedEmployees", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SyncedEmployees_Staff_StaffMemberId",
                        column: x => x.StaffMemberId,
                        principalSchema: "costing",
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayrollRunDepartments",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PayrollRunId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Employees = table.Column<int>(type: "integer", nullable: false),
                    GrossWages = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Additions = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Penalties = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    AdvancesDeducted = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NetCashPayable = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollRunDepartments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollRunDepartments_PayrollRuns_PayrollRunId",
                        column: x => x.PayrollRunId,
                        principalSchema: "costing",
                        principalTable: "PayrollRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_PayrollRunId",
                schema: "costing",
                table: "SafeTransactions",
                column: "PayrollRunId");

            migrationBuilder.CreateIndex(
                name: "IX_HrOutbox_CreatedAtUtc",
                schema: "costing",
                table: "HrOutbox",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_HrOutbox_Status_NextAttemptAtUtc",
                schema: "costing",
                table: "HrOutbox",
                columns: new[] { "Status", "NextAttemptAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_HrSyncLogs_AtUtc",
                schema: "costing",
                table: "HrSyncLogs",
                column: "AtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRunDepartments_PayrollRunId",
                schema: "costing",
                table: "PayrollRunDepartments",
                column: "PayrollRunId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_Period",
                schema: "costing",
                table: "PayrollRuns",
                column: "Period",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StaffDeductions_Date",
                schema: "costing",
                table: "StaffDeductions",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_StaffDeductions_EmployeeId",
                schema: "costing",
                table: "StaffDeductions",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_SyncedEmployees_HrEmployeeId",
                schema: "costing",
                table: "SyncedEmployees",
                column: "HrEmployeeId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SyncedEmployees_StaffMemberId",
                schema: "costing",
                table: "SyncedEmployees",
                column: "StaffMemberId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HrLinks",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "HrOutbox",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "HrSyncLogs",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PayrollRunDepartments",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "StaffDeductions",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SyncedEmployees",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PayrollRuns",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_SafeTransactions_PayrollRunId",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropColumn(
                name: "PayrollRunId",
                schema: "costing",
                table: "SafeTransactions");
        }
    }
}
