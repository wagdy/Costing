using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Access;
using Costing.Application.Common;
using Costing.Application.Menu;
using Costing.Application.Sales;
using Costing.Application.Staff;
using Costing.Application.Waste;
using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// The menu (قائمة الطعام): categories, items and sizes, add-ons. Read wherever recipes and sales
// are worked; changed on Menu.
[ApiController]
[Route("api/menu")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class MenuController(ISender sender) : ControllerBase
{
    private const int MaxImportBytes = 5 * 1024 * 1024;

    [HttpGet]
    [CostingTab(CostingTabs.Menu | CostingTabs.Recipes | CostingTabs.Sales | CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<MenuDto> GetMenu(CancellationToken cancellationToken) => sender.Send(new GetMenuQuery(), cancellationToken);

    [HttpPost("categories")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> AddCategory(MenuCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveMenuCategoryCommand(null, request.Name, request.NameAr, request.DisplayOrder), cancellationToken);

    [HttpPut("categories/{categoryId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> UpdateCategory(int categoryId, MenuCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveMenuCategoryCommand(categoryId, request.Name, request.NameAr, request.DisplayOrder), cancellationToken);

    [HttpDelete("categories/{categoryId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> DeleteCategory(int categoryId, CancellationToken cancellationToken) =>
        sender.Send(new DeleteMenuCategoryCommand(categoryId), cancellationToken);

    // A new item: Number, or the next one after the highest.
    [HttpPost("items")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> AddItem(MenuItemRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.Command(null), cancellationToken);

    [HttpPut("items/{itemId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> UpdateItem(int itemId, MenuItemRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.Command(itemId), cancellationToken);

    [HttpDelete("items/{itemId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> DeleteItem(int itemId, CancellationToken cancellationToken) =>
        sender.Send(new SetMenuItemDeletedCommand(itemId, true), cancellationToken);

    [HttpPost("items/{itemId:int}/restore")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> RestoreItem(int itemId, CancellationToken cancellationToken) =>
        sender.Send(new SetMenuItemDeletedCommand(itemId, false), cancellationToken);

    [HttpPost("add-ons")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> AddAddOn(AddOnRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveAddOnCommand(null, request.Name, request.NameAr, request.Price), cancellationToken);

    [HttpPut("add-ons/{addOnId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> UpdateAddOn(int addOnId, AddOnRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveAddOnCommand(addOnId, request.Name, request.NameAr, request.Price), cancellationToken);

    [HttpDelete("add-ons/{addOnId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> DeleteAddOn(int addOnId, CancellationToken cancellationToken) =>
        sender.Send(new SetAddOnDeletedCommand(addOnId, true), cancellationToken);

    [HttpPost("add-ons/{addOnId:int}/restore")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> RestoreAddOn(int addOnId, CancellationToken cancellationToken) =>
        sender.Send(new SetAddOnDeletedCommand(addOnId, false), cancellationToken);

    [HttpGet("template")]
    [CostingTab(CostingTabs.Menu)]
    public IActionResult Template() => File(MenuWorkbook.Build(), SheetFiles.ContentType, MenuWorkbook.FileName);

    [HttpPost("import")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<MenuImportResult> Import(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > MaxImportBytes)
            throw new DomainException("The file is larger than 5 MB: a menu's sheet is far smaller. Is it the right file?");
        await using var stream = file.OpenReadStream();
        return await sender.Send(new ImportMenuCommand(MenuWorkbook.Read(stream)), cancellationToken);
    }
}

public sealed record MenuCategoryRequest(string Name, string? NameAr, int? DisplayOrder);

public sealed record MenuItemRequest(
    int? Number, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable = true,
    IReadOnlyList<MenuSizeInput>? Sizes = null, IReadOnlyList<int>? AddOnIds = null)
{
    public SaveMenuItemCommand Command(int? id) =>
        new(id, Number, Name, NameAr, Category, Price, IsPriceBasedOnAddons, IsAvailable, Sizes, AddOnIds);
}

public sealed record AddOnRequest(string Name, string? NameAr, decimal Price);

// Sales (المبيعات): what the menu sold, entered or imported. A void is asked through the
// approvals (deletion-requests, module Sale), as the other voids are.
[ApiController]
[Route("api/sales")]
[Authorize(Policy = Permissions.InventoryView)]
[CostingTab(CostingTabs.Sales)]
public sealed class SalesController(ISender sender, IBusinessCalendar calendar) : ControllerBase
{
    private const int MaxImportBytes = 10 * 1024 * 1024;

    // A period's sales, a week to today unless asked.
    [HttpGet]
    public Task<SalesReport> GetSales([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return sender.Send(new GetSalesQuery(from ?? today.AddDays(-6), to ?? today), cancellationToken);
    }

    // Its id is made by the app: a retry after a lost answer records it once.
    [HttpPost]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SalesReceiptDto> Record(SaleInput sale, CancellationToken cancellationToken) =>
        sender.Send(new RecordSaleCommand(sale, UserClaims.NameOf(User)), cancellationToken);

    [HttpGet("template")]
    public IActionResult Template() => File(SalesWorkbook.Build(), SheetFiles.ContentType, SalesWorkbook.FileName);

    [HttpPost("import")]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<SalesImportResult> Import(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > MaxImportBytes)
            throw new DomainException("The file is larger than 10 MB: split the sheet by month.");
        await using var stream = file.OpenReadStream();
        return await sender.Send(new ImportSalesCommand(SalesWorkbook.Read(stream), UserClaims.NameOf(User)), cancellationToken);
    }
}

// Staff (الموظفين): who the safe pays advances and salaries to.
[ApiController]
[Route("api/staff")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class StaffController(ISender sender) : ControllerBase
{
    [HttpGet]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases | CostingTabs.Waste)]
    public Task<IReadOnlyList<StaffMemberDto>> GetStaff(CancellationToken cancellationToken) => sender.Send(new GetStaffQuery(), cancellationToken);

    [HttpPut("{staffId:guid}")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffMemberDto> Save(Guid staffId, StaffMemberRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveStaffMemberCommand(staffId, request.Name, request.JobTitle, request.IsActive), cancellationToken);
}

public sealed record StaffMemberRequest(string Name, string? JobTitle, bool IsActive = true);

// Permissions (الصلاحيات): the sections each user works, a manager's to give.
[ApiController]
[Route("api/access")]
[Authorize(Policy = Permissions.UsersManage)]
public sealed class AccessController(ISender sender, UserDirectory users) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<UserTabsDto>> GetAll(CancellationToken cancellationToken) =>
        await sender.Send(new GetUserTabsQuery(await AccountsAsync(cancellationToken)), cancellationToken);

    // Tabs: the sections, by name; none sent (null), back to the role's own.
    [HttpPut("{userId}")]
    public async Task<UserTabsDto> Set(string userId, SetTabsRequest request, CancellationToken cancellationToken)
    {
        var user = (await AccountsAsync(cancellationToken)).SingleOrDefault(u => u.Id == userId) ?? throw new NotFoundException("User", userId);
        return await sender.Send(new SetUserTabsCommand(user, request.Tabs is null ? null : CostingTabSet.Join(request.Tabs), UserClaims.NameOf(User)),
            cancellationToken);
    }

    private async Task<IReadOnlyList<UserAccountRef>> AccountsAsync(CancellationToken cancellationToken) =>
        (await users.GetAllAsync(cancellationToken)).Where(u => u.IsActive).Select(u => new UserAccountRef(u.Id, u.FullName, u.Role)).ToList();
}

public sealed record SetTabsRequest(IReadOnlyList<CostingTabs>? Tabs);

// Breakage (كسر) entered on Waste. Its void is asked through the approvals (module Breakage).
[ApiController]
[Route("api/costing/breakage")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Waste)]
public sealed class BreakageController(ISender sender) : ControllerBase
{
    [HttpPost]
    public Task<BreakageEntryDto> Record(BreakageRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RecordBreakageCommand(
            request.Id, request.Date, request.Description, request.Quantity, request.UnitCost, request.EmployeeId, request.Notes, UserClaims.NameOf(User)),
            cancellationToken);
}

public sealed record BreakageRequest(Guid Id, DateOnly Date, string Description, int Quantity, decimal? UnitCost, Guid? EmployeeId, string? Notes);

internal static class SheetFiles
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
