using MediatR;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.FixedAssets;

namespace Costing.Application.FixedAssets;

// The fixed assets register (سجل الأصول الثابتة): what moves no cash, a manager's. An asset bought,
// or sold for money, is a safe entry (SafeVoucher, AssetPurchase and AssetSale) and goes through
// the treasury: entered at once for a manager, asked of one for anyone else, voided as any entry is.
// Here: an asset owned already when the register started, its details changed, one disposed of with
// nothing for it, that undone, and one owned already taken off the register.

public sealed record FixedAssetSaved(Guid Id, string AssetCode);

// Owned already: on the register at what it cost and when, paid before it and through no entry here.
// AssetId is made by the till: a retry finds the asset made.
public sealed record RegisterOwnedAssetCommand(Guid AssetId, FixedAssetInput Asset, DateOnly PurchaseDate, decimal PurchaseCost, string By)
    : IRequest<FixedAssetSaved>, IRetryOnConflict;

// What it is and what its depreciation is worked out from; for one owned already, its cost and the
// day it was bought too (a paid one's are its payment's).
public sealed record ChangeFixedAssetCommand(Guid AssetId, FixedAssetInput Asset, DateOnly? PurchaseDate, decimal? PurchaseCost, string By)
    : IRequest<FixedAssetSaved>, IRetryOnConflict;

// Disposed of with nothing for it (استبعاد): its depreciation stops, what was left of its cost is the
// month's loss. Sold for money is a safe entry instead.
public sealed record WriteOffFixedAssetCommand(Guid AssetId, DateOnly Date, string? Notes, string By) : IRequest<FixedAssetSaved>, IRetryOnConflict;

// A write-off undone: in use again, depreciated from where it stopped.
public sealed record ReinstateFixedAssetCommand(Guid AssetId, string By) : IRequest<FixedAssetSaved>, IRetryOnConflict;

// One owned already, off the register (entered by mistake). A paid one goes with its purchase voided.
public sealed record RemoveFixedAssetCommand(Guid AssetId, string By) : IRequest, IRetryOnConflict;

internal sealed class RegisterOwnedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<RegisterOwnedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(RegisterOwnedAssetCommand request, CancellationToken cancellationToken)
    {
        if (await assets.GetByIdAsync(request.AssetId, cancellationToken) is { } made)
            return new FixedAssetSaved(made.Id, made.AssetCode);
        if (request.PurchaseDate > treasury.Latest)
            throw new DomainException("An asset owned already was bought today or before. · تاريخ الشراء اليوم أو قبله.");
        var a = request.Asset ?? throw new DomainException("Say what the asset is. · أدخل بيانات الأصل.");
        var asset = new FixedAsset(
            request.AssetId, await assets.NextNumberAsync(cancellationToken), a.Name, a.Category, a.Location, a.Notes, request.PurchaseDate,
            request.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths, null, null, request.By);
        assets.Add(asset);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class ChangeFixedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<ChangeFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(ChangeFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        var a = request.Asset ?? throw new DomainException("Say what the asset is. · أدخل بيانات الأصل.");
        var (date, cost) = (request.PurchaseDate ?? asset.PurchaseDate, request.PurchaseCost ?? asset.PurchaseCost);
        if (date != asset.PurchaseDate || cost != asset.PurchaseCost)
        {
            if (date > treasury.Latest)
                throw new DomainException("An asset owned already was bought today or before. · تاريخ الشراء اليوم أو قبله.");
            asset.Recost(date, cost, a.SalvageValue, request.By);
        }
        asset.Change(a.Name, a.Category, a.Location, a.Notes, a.SalvageValue, a.UsefulLifeMonths, request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class WriteOffFixedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<WriteOffFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(WriteOffFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        // Retried after it was saved: done already.
        if (asset.Status == FixedAssetStatus.Disposed && asset.DisposalDate == request.Date)
            return new FixedAssetSaved(asset.Id, asset.AssetCode);
        if (request.Date > treasury.Latest)
            throw new DomainException("An asset is disposed of today or before. · تاريخ الاستبعاد اليوم أو قبله.");
        asset.WriteOff(request.Date, request.Notes, request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class ReinstateFixedAssetHandler(IFixedAssetRepository assets, IUnitOfWork unitOfWork)
    : IRequestHandler<ReinstateFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(ReinstateFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        if (asset.Status == FixedAssetStatus.Sold)
            throw new DomainException("A sale is undone by voiding its entry: what it brought in goes back out. · ألغِ قيد البيع.");
        if (asset.IsGone)
        {
            asset.Reinstate(request.By);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class RemoveFixedAssetHandler(IFixedAssetRepository assets, IUnitOfWork unitOfWork) : IRequestHandler<RemoveFixedAssetCommand>
{
    public async Task Handle(RemoveFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await assets.GetByIdAsync(request.AssetId, cancellationToken) ?? throw new NotFoundException("Fixed asset", request.AssetId);
        if (asset.IsVoided)
            return;
        if (!asset.IsOwnedAlready)
            throw new DomainException("A paid asset leaves the register with its purchase voided: what it cost goes back. · ألغِ قيد الشراء.");
        asset.Void(request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

internal static class FixedAssetRules
{
    public static async Task<FixedAsset> GetAsync(IFixedAssetRepository assets, Guid id, CancellationToken cancellationToken)
    {
        var asset = await assets.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Fixed asset", id);
        return asset.IsVoided ? throw new DomainException("This asset is off the register. · الأصل محذوف من السجل.") : asset;
    }
}

// Where a fixed asset bought was paid from: the safe or the bank (a safe entry), or not through the
// treasury at all, owned already when the register started.
public enum AssetPaymentSource
{
    Safe = 1,
    Bank = 2,
    OwnedAlready = 3,
}
