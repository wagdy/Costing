using MediatR;
using Costing.Application.Common;
using Costing.Application.Sales;
using Costing.Domain.Sales;

namespace Costing.Infrastructure.Tests;

// A stand-in for the point of sale the costs used to read: a bill opened, items added, sent to the
// kitchen, voided and paid, as a till does it, and recorded here as a sale is (RecordSaleCommand)
// when it is paid, a void after payment as a refund (RefundSaleCommand). So the tests carried over
// from the till sell as they always did, through the Sales the system has now. The bill's tax is
// the till's: 14% of the items, rounded as the till rounds it.
public enum OrderType
{
    DineIn,
}

public sealed class Order
{
    public Guid PublicId { get; } = Guid.NewGuid();
    public List<OrderItem> OrderItems { get; } = [];
    public bool SentToKitchen { get; set; }
    public PaymentMethod? PaymentMethod { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal TotalAmount { get; set; }
    public decimal RefundedAmount { get; set; }

    // The sale it was recorded as, once paid.
    public Guid SaleId { get; } = Guid.NewGuid();
    public bool IsPaid => PaymentMethod is not null;
}

public sealed class OrderItem
{
    public Guid PublicId { get; set; } = Guid.NewGuid();
    public int MenuItemId { get; init; }
    public int? VariantId { get; init; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; init; }
    public IReadOnlyList<int> AddOnIds { get; init; } = [];
    public LineVoid Voided { get; set; }
    public bool IsVoided => Voided != LineVoid.None;
    public decimal LineTotal => UnitPrice * Quantity;
}

public sealed class Till
{
    public Dictionary<Guid, Order> Orders { get; } = [];

    public Order Get(Guid id) => Orders.TryGetValue(id, out var order) ? order : throw new InvalidOperationException("No such order.");
}

public sealed record OpenOrderCommand(OrderType Type, string? TableNumber = null) : IRequest<Order>;

public sealed record AddOrderItemCommand(Guid OrderId, int MenuItemId, int Quantity = 1, int? VariantId = null, IReadOnlyList<int>? AddOnIds = null)
    : IRequest<Order>;

public sealed record SendToKitchenCommand(Guid OrderId) : IRequest<Order>;

public sealed record CheckoutCommand(Guid OrderId, PaymentMethod PaymentMethod) : IRequest<Order>;

public sealed record VoidOrderItemCommand(Guid OrderId, Guid OrderItemId, int Quantity, string? Reason) : IRequest<Order>;

public sealed record VoidOrderCommand(Guid OrderId, string? Reason) : IRequest<Order>;

internal sealed class TillHandlers(Till till, ISender sender, Costing.Infrastructure.Persistence.CostingDbContext db, IBusinessCalendar calendar)
    : IRequestHandler<OpenOrderCommand, Order>, IRequestHandler<AddOrderItemCommand, Order>, IRequestHandler<SendToKitchenCommand, Order>,
        IRequestHandler<CheckoutCommand, Order>, IRequestHandler<VoidOrderItemCommand, Order>, IRequestHandler<VoidOrderCommand, Order>
{
    public Task<Order> Handle(OpenOrderCommand request, CancellationToken cancellationToken)
    {
        var order = new Order();
        till.Orders[order.PublicId] = order;
        return Task.FromResult(order);
    }

    public async Task<Order> Handle(AddOrderItemCommand request, CancellationToken cancellationToken)
    {
        var order = till.Get(request.OrderId);
        var item = await db.MenuItems.FindAsync([request.MenuItemId], cancellationToken) ?? throw new InvalidOperationException("Not on the menu.");
        var price = request.VariantId is { } v ? item.Variants.Single(x => x.Id == v).Price : item.Price;
        foreach (var addOnId in request.AddOnIds ?? [])
            price += (await db.AddOns.FindAsync([addOnId], cancellationToken))!.Price;
        order.OrderItems.Add(new OrderItem
        {
            MenuItemId = request.MenuItemId, VariantId = request.VariantId, Quantity = request.Quantity, UnitPrice = price, AddOnIds = request.AddOnIds ?? [],
        });
        return order;
    }

    public Task<Order> Handle(SendToKitchenCommand request, CancellationToken cancellationToken)
    {
        var order = till.Get(request.OrderId);
        order.SentToKitchen = true;
        return Task.FromResult(order);
    }

    public async Task<Order> Handle(CheckoutCommand request, CancellationToken cancellationToken)
    {
        var order = till.Get(request.OrderId);
        var billed = order.OrderItems.Where(i => !i.IsVoided).Sum(i => i.LineTotal);
        order.TaxAmount = Math.Round(billed * (TestMenu.TaxPercent / 100m), 2);
        order.TotalAmount = billed + order.TaxAmount;
        order.PaymentMethod = request.PaymentMethod;
        var now = calendar.ToLocal(DateTime.UtcNow);
        var sale = await sender.Send(new RecordSaleCommand(new SaleInput(
            order.SaleId, null, calendar.BusinessDateOf(DateTime.UtcNow), TimeOnly.FromDateTime(now), SalesChannel.DineIn, request.PaymentMethod,
            order.OrderItems.Select(i => new SaleLineInput(i.MenuItemId, i.VariantId, i.Quantity, i.LineTotal, i.AddOnIds, i.Voided)).ToList(),
            TaxAmount: order.TaxAmount), "Sara"), cancellationToken);
        // The sale's own lines from now on: a refund names them.
        for (var i = 0; i < order.OrderItems.Count; i++)
            order.OrderItems[i].PublicId = sale.Lines[i].PublicId;
        return order;
    }

    public async Task<Order> Handle(VoidOrderItemCommand request, CancellationToken cancellationToken)
    {
        var order = till.Get(request.OrderId);
        var item = order.OrderItems.Single(i => i.PublicId == request.OrderItemId);
        if (order.IsPaid)
        {
            var sale = await sender.Send(new RefundSaleCommand(order.SaleId, item.PublicId, request.Quantity, "Sara"), cancellationToken);
            order.RefundedAmount = sale.RefundedAmount;
            return order;
        }

        var stage = order.SentToKitchen ? LineVoid.AfterKitchen : LineVoid.BeforeKitchen;
        if (request.Quantity < item.Quantity)
        {
            item.Quantity -= request.Quantity;
            order.OrderItems.Add(new OrderItem
            {
                MenuItemId = item.MenuItemId, VariantId = item.VariantId, Quantity = request.Quantity, UnitPrice = item.UnitPrice, AddOnIds = item.AddOnIds,
                Voided = stage,
            });
        }
        else
        {
            item.Voided = stage;
        }

        return order;
    }

    // After payment, the whole bill refunded; before it, every item off the bill.
    public async Task<Order> Handle(VoidOrderCommand request, CancellationToken cancellationToken)
    {
        var order = till.Get(request.OrderId);
        if (order.IsPaid)
        {
            var sale = await sender.Send(new RefundSaleCommand(order.SaleId, null, null, "Sara"), cancellationToken);
            order.RefundedAmount = sale.RefundedAmount;
            return order;
        }

        foreach (var item in order.OrderItems.Where(i => !i.IsVoided))
            item.Voided = order.SentToKitchen ? LineVoid.AfterKitchen : LineVoid.BeforeKitchen;
        return order;
    }
}
