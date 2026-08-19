export const orderStatuses = ["new", "accepted", "preparing", "ready", "delivering", "completed", "cancelled"];

export const orderStatusLabels = {
  new: "Заказ получен",
  accepted: "Заказ принят",
  preparing: "Готовится",
  ready: "Заказ готов",
  delivering: "Передан курьеру",
  completed: "Заказ выполнен",
  cancelled: "Заказ отменён"
};

export const legacyOrderStatuses = {
  "Новый": "new",
  "Подтверждён": "accepted",
  "Готовится": "preparing",
  "Готов": "ready",
  "Передан в доставку": "delivering",
  "Выполнен": "completed",
  "Отменён": "cancelled"
};

export const orderStatusTransitions = {
  new: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivering", "completed", "cancelled"],
  delivering: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export const orderStatusTimestamp = {
  accepted: "acceptedAt",
  preparing: "preparingAt",
  ready: "readyAt",
  delivering: "deliveringAt",
  completed: "completedAt",
  cancelled: "cancelledAt"
};

export function availableOrderTransitions(order) {
  return (orderStatusTransitions[order.status] || []).filter((status) => !(status === "delivering" && order.fulfillmentType === "pickup"));
}

export function isOrderTransitionAllowed(order, targetStatus) {
  return availableOrderTransitions(order).includes(targetStatus);
}
