import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Beef, Bike, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, Flame, Grid2X2, Heart, House, Leaf, List, MapPin, Menu as MenuIcon, MessageCircle, Package, Phone, Plus, RefreshCw, Search, Send, ShoppingBag, SlidersHorizontal, Star, Store, Target, UserRound, Users, WalletCards, X } from "lucide-react";
import { apiFetch, apiUrl } from "./api";

type Category = { id: string; name: string; minPrice: string; sortOrder: number; isActive?: boolean };
type Addon = { id: string; name: string; price: number; isActive: boolean; group: string; description?: string; imageUrl?: string; isCustomerVisible?: boolean; sortOrder?: number };
type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  step: number;
  categoryId: string;
  imageUrl: string;
  isActive: boolean;
  isAvailable: boolean;
  isFeatured: boolean;
  badge?: string;
  options?: string[];
  addonGroup?: string;
  addonIds?: string[];
  sortOrder: number;
};
type PickupPoint = { id: string; name: string; address: string; phone: string; hours: string; mapUrl: string; comment?: string; description?: string; imageUrl?: string; services?: string[]; sortOrder?: number; isActive: boolean };
type Settings = {
  brand: string;
  phone: string;
  telegramBrand: string;
  telegramOrders: string;
  workHours: string;
  deliveryPrice: number;
  freeDeliveryFrom: number;
  deliveryRegions: string;
  yandexFoodUrl: string;
  deliveryUrl: string;
  socialUrl: string;
};
type Bootstrap = { categories: Category[]; products: Product[]; addons: Addon[]; pickupPoints: PickupPoint[]; settings: Settings };
type CartItem = { productId: string; quantity: number; option?: string; addons: string[] };
type UserRole = "EMPLOYEE" | "MANAGER" | "CO_OWNER" | "OWNER";
type ShiftType = "DAY" | "NIGHT";
type ThemeMode = "auto" | "day" | "night";
type ActiveTheme = "day" | "night";
type AdminUser = {
  id: string;
  login: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: UserRole;
  position: string;
  avatarUrl: string;
  phone: string;
  workPointId: string;
  shiftType: ShiftType;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername: string;
  isActive: boolean;
  lastLoginAt?: string;
  updatedAt?: string;
};
type OrderStatus = "new" | "accepted" | "preparing" | "ready" | "delivering" | "completed" | "cancelled";
type AnalyticsSummary = { sessions: number; events: number; checkoutErrors: number; funnel: Record<string, number>; sources: Array<{ source: string; orders: number; revenue?: number }> };
type OrderHistoryEntry = { id: string; orderId: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; changedAt: string; changedByUserId: string | null; source: string };
type AdminBootstrap = Bootstrap & { orders: Order[]; orderStatusHistory: OrderHistoryEntry[]; orderStatuses: OrderStatus[]; orderStatusLabels: Record<OrderStatus, string>; users: AdminUser[]; currentUser: AdminUser; permissions: string[]; analyticsSummary: AnalyticsSummary | null };
type Attribution = { utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string; referrer: string; landing_page: string };

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  deliveryType: "delivery" | "pickup";
  address: string;
  comment: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  intercom?: string;
  pickupPointName?: string;
  paymentMethod?: string;
  items: Array<{ name: string; quantity: number; quantityLabel?: string; unit: string; total: number; option?: string; addons: Addon[] }>;
  subtotal: number;
  deliveryPrice: number;
  total: number;
  status: OrderStatus;
  availableTransitions: OrderStatus[];
  telegram?: { sent: boolean; reason?: string };
  createdAt: string;
};

type TrackingOrder = {
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  publicStatus: OrderStatus;
  fulfillmentType: "delivery" | "pickup";
  createdAt: string;
  updatedAt: string;
  acceptedAt: string;
  preparingAt: string;
  readyAt: string;
  deliveringAt: string;
  completedAt: string;
  cancelledAt: string;
  items: Array<{ productId: string; name: string; imageUrl: string; quantity: number; quantityLabel?: string; option?: string; addons: Array<{ name: string }>; total: number }>;
  subtotal: number;
  deliveryPrice: number;
  total: number;
  pickupPointName: string;
  address: string;
  apartment: string;
  entrance: string;
  floor: string;
  intercom: string;
  comment: string;
  paymentMethod: string;
  canReview: boolean;
  review: { rating: number; comment: string; createdAt: string } | null;
};

const orderStatusMeta: Record<OrderStatus, { label: string }> = {
  new: { label: "Заказ создан" },
  accepted: { label: "Заказ принят" },
  preparing: { label: "Готовим" },
  ready: { label: "Заказ готов" },
  delivering: { label: "Передан курьеру" },
  completed: { label: "Заказ доставлен" },
  cancelled: { label: "Заказ отменён" }
};

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;
const isWeightedProduct = (product: Product) => product.step > 1 && product.unit.includes("г");
const quantityUnits = (product: Product, quantity: number) => (isWeightedProduct(product) ? quantity / product.step : quantity);
const lineItemTotal = (product: Product, quantity: number, addonsTotal = 0) => Math.round((product.price + addonsTotal) * quantityUnits(product, quantity));
const formatQuantity = (product: Product, quantity: number) => (isWeightedProduct(product) ? `${quantity} г` : `${quantity} шт`);
const roleLabel = (role: UserRole) => ({ EMPLOYEE: "Сотрудник", MANAGER: "Управляющий", CO_OWNER: "Совладелец", OWNER: "Владелец" }[role]);
const shiftLabel = (shift: ShiftType) => (shift === "NIGHT" ? "Ночная смена · 21:00–09:00" : "Дневная смена · 09:00–21:00");
const currentShiftTheme = (): ActiveTheme => {
  const hour = new Date().getHours();
  return hour >= 9 && hour < 21 ? "day" : "night";
};
const formatRussianPhone = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.startsWith("9")) digits = `7${digits}`;
  if (!digits.startsWith("7")) digits = `7${digits}`;
  digits = digits.slice(0, 11);
  const body = digits.slice(1);
  const parts = [body.slice(0, 3), body.slice(3, 6), body.slice(6, 8), body.slice(8, 10)];
  let formatted = "+7";
  if (parts[0]) formatted += ` (${parts[0]}`;
  if (parts[0]?.length === 3) formatted += ")";
  if (parts[1]) formatted += ` ${parts[1]}`;
  if (parts[2]) formatted += `-${parts[2]}`;
  if (parts[3]) formatted += `-${parts[3]}`;
  return formatted;
};
const readImageAsDataUrl = (file: File, onLoad: (value: string) => void) => {
  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result || ""));
  reader.readAsDataURL(file);
};
const userName = (user: AdminUser) => `${user.firstName} ${user.lastName}`.trim() || user.displayName || user.login;
const pointName = (admin: AdminBootstrap, id: string) => admin.pickupPoints.find((point) => point.id === id)?.name || "";
const telegramReasonText = (reason?: string) => {
  if (!reason) return "Нет проверенных заказов";
  if (reason === "not_configured") return "Не настроены данные бота";
  if (reason.toLowerCase().includes("fetch failed")) return "Нет доступа к Telegram API";
  if (reason.toLowerCase().includes("telegram")) return "Telegram вернул ошибку";
  return "Не отправлено";
};
const paymentMethodText = (method?: string) => method === "TRANSFER_ON_DELIVERY" ? "Переводом при получении" : method === "CASH_ON_DELIVERY" ? "Наличными при получении" : method === "PAY_ON_DELIVERY" ? "При получении" : "Картой при получении";

const emptyAttribution: Attribution = { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "", referrer: "", landing_page: "" };

function captureAttribution() {
  try {
    const existing = JSON.parse(sessionStorage.getItem("shashlik-attribution") || "null") as Attribution | null;
    if (existing) return existing;
    const params = new URLSearchParams(window.location.search);
    const attribution: Attribution = {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      utm_term: params.get("utm_term") || "",
      referrer: document.referrer.slice(0, 300),
      landing_page: `${window.location.pathname}${window.location.search}`.slice(0, 300)
    };
    sessionStorage.setItem("shashlik-attribution", JSON.stringify(attribution));
    return attribution;
  } catch {
    return emptyAttribution;
  }
}

function analyticsSessionId() {
  try {
    const existing = sessionStorage.getItem("shashlik-session-id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("shashlik-session-id", id);
    return id;
  } catch {
    return "";
  }
}

function trackEvent(name: string, data: Record<string, string | number> = {}) {
  const body = JSON.stringify({ name, data, sessionId: analyticsSessionId(), pathname: window.location.pathname, attribution: captureAttribution() });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(apiUrl("/api/analytics"), new Blob([body], { type: "application/json" }));
  } else {
    void apiFetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  }
}

function setActiveOrderToken(token: string) {
  localStorage.setItem("activeOrderTrackingToken", token);
  window.dispatchEvent(new CustomEvent("active-order-changed"));
}

function clearActiveOrderToken(token?: string) {
  if (!token || localStorage.getItem("activeOrderTrackingToken") === token) {
    localStorage.removeItem("activeOrderTrackingToken");
    window.dispatchEvent(new CustomEvent("active-order-changed"));
  }
}
const defaultSettings: Settings = {
  brand: "Шашлык Лайк",
  phone: "+7 995 669-12-42",
  telegramBrand: "@ShashlikLike",
  telegramOrders: "@iamartush1an",
  workHours: "09:00–22:00",
  deliveryPrice: 500,
  freeDeliveryFrom: 2000,
  deliveryRegions: "Правый берег Воронежа\nЦентральный район",
  yandexFoodUrl: "",
  deliveryUrl: "",
  socialUrl: ""
};

function useBootstrap() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    setError("");
    try {
      const response = await apiFetch("/api/bootstrap", { headers: { accept: "application/json" } });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) throw new Error("API unavailable");
      const payload = await response.json() as Bootstrap;
      if (!Array.isArray(payload.products) || !Array.isArray(payload.categories) || !payload.settings) throw new Error("Invalid API response");
      setData(payload);
    } catch {
      setError("Не удалось подключиться к серверу меню. Проверьте соединение и повторите.");
    }
  }

  useEffect(() => { void reload(); }, []);

  return { data, error, reload };
}

function fetchTrackingOrder(token: string) {
  return apiFetch(`/api/orders/track/${encodeURIComponent(token)}`, { cache: "no-store" });
}

function useActiveOrder(enabled = true) {
  const [order, setOrder] = useState<TrackingOrder | null>(null);

  useEffect(() => {
    if (!enabled) {
      setOrder(null);
      return;
    }
    let active = true;
    let timer = 0;
    const load = async () => {
      const token = localStorage.getItem("activeOrderTrackingToken") || "";
      if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) {
        if (active) setOrder(null);
        return;
      }
      try {
        const response = await fetchTrackingOrder(token);
        if (response.status === 404) {
          clearActiveOrderToken(token);
          if (active) setOrder(null);
          return;
        }
        if (!response.ok) return;
        const payload = await response.json() as { order: TrackingOrder };
        if (["completed", "cancelled"].includes(payload.order.status)) {
          clearActiveOrderToken(token);
          if (active) setOrder(null);
          return;
        }
        if (active) setOrder(payload.order);
      } catch {
        // Keep the last server-confirmed state while the connection is unavailable.
      }
    };
    const handleChange = () => void load();
    void load();
    timer = window.setInterval(load, 10_000);
    window.addEventListener("active-order-changed", handleChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("active-order-changed", handleChange);
    };
  }, [enabled]);

  return order;
}

function useCart(data: Bootstrap | null) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("shashlik-cart") || "[]") as unknown;
      if (!Array.isArray(stored)) return [];
      return stored.filter((item): item is CartItem => Boolean(
        item && typeof item === "object" && typeof item.productId === "string" &&
        typeof item.quantity === "number" && item.quantity > 0 && Array.isArray(item.addons)
      ));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("shashlik-cart", JSON.stringify(items));
  }, [items]);

  const productsById = useMemo(() => new Map((data?.products || []).map((product) => [product.id, product])), [data]);
  const addonsById = useMemo(() => new Map((data?.addons || []).map((addon) => [addon.id, addon])), [data]);

  const detailed = useMemo(
    () =>
      items
        .map((item) => {
          const product = productsById.get(item.productId);
          if (!product) return null;
          const addons = item.addons.map((id) => addonsById.get(id)).filter(Boolean) as Addon[];
          const addonsTotal = addons.reduce((sum, addon) => sum + addon.price, 0);
          return { ...item, product, addons, lineTotal: lineItemTotal(product, item.quantity, addonsTotal) };
        })
        .filter(Boolean) as Array<Omit<CartItem, "addons"> & { product: Product; addons: Addon[]; lineTotal: number }>,
    [items, productsById, addonsById]
  );

  const subtotal = detailed.reduce((sum, item) => sum + item.lineTotal, 0);
  const settings = data?.settings || defaultSettings;
  const deliveryPrice = subtotal > 0 && subtotal < settings.freeDeliveryFrom ? settings.deliveryPrice : 0;
  const total = subtotal + deliveryPrice;
  const count = detailed.reduce((sum, item) => sum + quantityUnits(item.product, item.quantity), 0);

  function sameItem(item: CartItem, productId: string, option = "", addons: string[] = []) {
    return item.productId === productId && (item.option || "") === option && item.addons.slice().sort().join(",") === addons.slice().sort().join(",");
  }

  function add(product: Product, quantity: number, option = "", addons: string[] = []) {
    setItems((current) => {
      const existing = current.find((item) => sameItem(item, product.id, option, addons));
      if (existing) {
        return current.map((item) => (sameItem(item, product.id, option, addons) ? { ...item, quantity: item.quantity + quantity } : item));
      }
      return [...current, { productId: product.id, quantity, option, addons }];
    });
  }

  function update(index: number, quantity: number) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: Math.max(quantity, 1) } : item)));
  }

  function remove(index: number) {
    const removed = detailed[index];
    if (removed) trackEvent("remove_from_cart", { productId: removed.product.id, quantity: removed.quantity, value: removed.lineTotal });
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function clear() {
    setItems([]);
  }

  return { items, detailed, subtotal, deliveryPrice, total, count, add, update, remove, clear };
}

function App() {
  const { data, error, reload } = useBootstrap();
  const cart = useCart(data);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("theme-mode") as ThemeMode | null;
    return saved === "day" || saved === "night" || saved === "auto" ? saved : "auto";
  });
  const activeTheme = themeMode === "auto" ? currentShiftTheme() : themeMode;
  const isAdmin = location.pathname.startsWith("/admin");
  const isOrderPage = location.pathname.startsWith("/order/");
  const isHome = location.pathname === "/";
  const usesHomeDesign = isHome || isOrderPage || location.pathname === "/menu" || location.pathname === "/delivery" || location.pathname === "/pickup" || location.pathname === "/about" || location.pathname === "/contacts";
  const activeOrder = useActiveOrder(!isAdmin && !isOrderPage);

  useRouteMetadata(location.pathname);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    localStorage.setItem("theme-mode", themeMode);
  }, [activeTheme, themeMode]);

  useEffect(() => {
    captureAttribution();
    trackEvent("page_view");
    if (location.pathname === "/menu") trackEvent("menu_view");
  }, [location.pathname]);

  const addToCart = (product: Product, quantity: number, option = "", addons: string[] = []) => {
    cart.add(product, quantity, option, addons);
    trackEvent("add_to_cart", { productId: product.id, quantity, value: lineItemTotal(product, quantity) });
    setToast("Добавлено в корзину");
    window.setTimeout(() => setToast(""), 2400);
  };

  if (error) return <SystemState title="Ошибка" text={error} actionLabel="Повторить" onAction={() => void reload()} />;
  if (!data) return <SystemState title="ШАШЛЫК ЛАЙК" text="Загружаем меню..." />;

  return (
    <>
      {!isAdmin && !usesHomeDesign && <Header settings={data.settings} themeMode={themeMode} activeTheme={activeTheme} onThemeMode={setThemeMode} />}
      {!isAdmin && !usesHomeDesign && activeOrder && <ActiveOrderIndicator order={activeOrder} />}
      <div className="delivery-content">
        <Routes>
          <Route path="/" element={<Home data={data} onAdd={addToCart} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} activeOrder={activeOrder} />} />
          <Route path="/menu" element={<Menu data={data} onAdd={addToCart} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} activeOrder={activeOrder} />} />
          <Route path="/product/:slug" element={<ProductPage data={data} onAdd={addToCart} />} />
          <Route path="/delivery" element={<Delivery data={data} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} activeOrder={activeOrder} />} />
          <Route path="/pickup" element={<Navigate to="/delivery#kiosks" replace />} />
          <Route path="/about" element={<About settings={data.settings} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} activeOrder={activeOrder} />} />
          <Route path="/contacts" element={<Contacts data={data} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} activeOrder={activeOrder} />} />
          <Route path="/cart" element={<CartPage data={data} cart={cart} />} />
          <Route path="/checkout" element={<Checkout data={data} cart={cart} />} />
          <Route path="/order-success" element={<Success settings={data.settings} />} />
          <Route path="/order/:trackingToken" element={<OrderTracking settings={data.settings} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} />} />
          <Route path="/admin" element={<Admin onChanged={reload} themeMode={themeMode} activeTheme={activeTheme} onThemeMode={setThemeMode} />} />
          <Route path="*" element={<SystemState title="404" text="Такой страницы нет." />} />
        </Routes>
      </div>
      {!isAdmin && !usesHomeDesign && <Footer settings={data.settings} />}
      {!isAdmin && !usesHomeDesign && <FloatingCart count={cart.count} total={cart.subtotal} onClick={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} />}
      <CartDrawer data={data} cart={cart} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {toast && (
        <div className="toast" role="status">
          <strong>{toast}</strong>
          <Link to="/cart">Перейти в корзину</Link>
        </div>
      )}
    </>
  );
}

function useRouteMetadata(pathname: string) {
  useEffect(() => {
    const privateRoute = pathname.startsWith("/order/") || pathname.startsWith("/admin") || pathname === "/checkout" || pathname === "/cart";
    const metadata: Record<string, [string, string]> = {
      "/": ["Шашлык с доставкой в Воронеже | Шашлык Лайк", "Шашлык, шаурма, люля и блюда на углях с доставкой по Воронежу. Заказ онлайн, оплата при получении."],
      "/menu": ["Меню и цены | Шашлык Лайк", "Актуальное меню Шашлык Лайк: шашлык, шаурма, люля-кебаб, соусы, хлеб и напитки."],
      "/delivery": ["Доставка шашлыка по Воронежу | Шашлык Лайк", "Условия и стоимость доставки горячих блюд Шашлык Лайк по Воронежу."],
      "/pickup": ["Самовывоз | Шашлык Лайк", "Точки и условия самовывоза заказов Шашлык Лайк."],
      "/about": ["О Шашлык Лайк", "Как мы готовим мясо и блюда на углях в Шашлык Лайк."],
      "/contacts": ["Контакты | Шашлык Лайк", "Телефон, время работы и способы связи с Шашлык Лайк в Воронеже."]
    };
    const privateMetadata: Record<string, [string, string]> = {
      "/cart": ["Корзина | Шашлык Лайк", "Корзина заказа Шашлык Лайк."],
      "/checkout": ["Оформление заказа | Шашлык Лайк", "Оформление заказа в Шашлык Лайк."]
    };
    const [title, description] = metadata[pathname] || privateMetadata[pathname] || (privateRoute
      ? [pathname.startsWith("/admin") ? "Админ-панель | Шашлык Лайк" : "Статус заказа | Шашлык Лайк", "Служебная страница Шашлык Лайк."]
      : ["Страница не найдена | Шашлык Лайк", "Запрошенная страница не найдена."]);
    document.title = title;
    const setMeta = (selector: string, attribute: string, value: string) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement("meta");
        const [key, keyValue] = attribute.split(":");
        node.setAttribute(key, keyValue);
        document.head.appendChild(node);
      }
      node.content = value;
    };
    setMeta('meta[name="description"]', "name:description", description);
    setMeta('meta[name="robots"]', "name:robots", privateRoute ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large");
    setMeta('meta[property="og:title"]', "property:og:title", title);
    setMeta('meta[property="og:description"]', "property:og:description", description);
    const canonicalUrl = privateRoute ? window.location.origin : `${window.location.origin}${pathname}`;
    setMeta('meta[property="og:url"]', "property:og:url", canonicalUrl);
    setMeta('meta[property="og:image"]', "property:og:image", `${window.location.origin}/assets/shashlik-hero-optimized.jpg`);
    setMeta('meta[name="twitter:title"]', "name:twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name:twitter:description", description);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [pathname]);
}

type OrderStageKind = "created" | "cooking" | "handoff" | "completed";
type OrderStage = { key: string; label: string; kind: OrderStageKind; timestamp: string };

function orderStages(order: TrackingOrder): OrderStage[] {
  const pickup = order.fulfillmentType === "pickup";
  return [
    { key: "created", label: "Заказ создан", kind: "created", timestamp: order.createdAt },
    { key: "cooking", label: order.status === "ready" ? "Заказ готов" : "Готовим", kind: "cooking", timestamp: order.preparingAt || order.acceptedAt },
    { key: "handoff", label: pickup ? "Можно забирать" : "Передан курьеру", kind: "handoff", timestamp: pickup ? order.readyAt : order.deliveringAt },
    { key: "completed", label: pickup ? "Заказ выдан" : "Доставлен", kind: "completed", timestamp: order.completedAt }
  ];
}

function orderStageIndex(order: TrackingOrder) {
  if (order.status === "cancelled") return -1;
  if (order.status === "completed") return 3;
  if (order.fulfillmentType === "pickup" && order.status === "ready") return 2;
  if (order.status === "delivering") return 2;
  if (["accepted", "preparing", "ready"].includes(order.status)) return 1;
  return 0;
}

function OrderStageIcon({ kind }: { kind: OrderStageKind }) {
  if (kind === "created") return <Check aria-hidden="true" />;
  if (kind === "cooking") return <ChefHat aria-hidden="true" />;
  if (kind === "handoff") return <Bike aria-hidden="true" />;
  return <House aria-hidden="true" />;
}

function statusMessage(order: TrackingOrder) {
  if (order.status === "new") return "Ожидает подтверждения";
  if (order.status === "accepted") return "Заказ принят";
  if (order.status === "preparing") return "Готовим ваш заказ";
  if (order.status === "ready") return order.fulfillmentType === "pickup" ? "Можно забирать" : "Готов к отправке";
  if (order.status === "delivering") return "Заказ в пути";
  if (order.status === "completed") return order.fulfillmentType === "pickup" ? "Заказ выдан" : "Заказ доставлен";
  return "Заказ отменён";
}

function formatOrderTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ActiveOrderIndicator({ order }: { order: TrackingOrder }) {
  const token = localStorage.getItem("activeOrderTrackingToken") || "";
  if (!token) return null;
  const stages = orderStages(order);
  const currentIndex = orderStageIndex(order);
  return (
    <aside className="active-order-indicator" aria-label={`Активный заказ ${order.orderNumber}`} aria-live="polite">
      <div className="active-order-summary"><span className="active-order-pulse" aria-hidden="true" /><span><strong>Ваш заказ #{order.orderNumber}</strong><small>{statusMessage(order)}</small></span></div>
      <ol className="active-order-progress" aria-label="Этапы заказа">
        {stages.map((stage, index) => <li key={stage.key} className={index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending"}><i><OrderStageIcon kind={stage.kind} /></i><span>{stage.label}</span></li>)}
      </ol>
      <Link className="active-order-link" to={`/order/${encodeURIComponent(token)}`} aria-label={`Открыть статус заказа ${order.orderNumber}`}>Статус заказа <ArrowRight aria-hidden="true" /></Link>
    </aside>
  );
}

function Header({ settings, themeMode, activeTheme, onThemeMode }: { settings: Settings; themeMode: ThemeMode; activeTheme: ActiveTheme; onThemeMode: (mode: ThemeMode) => void }) {
  const [open, setOpen] = useState(false);
  const links = [
    ["Меню", "/menu"],
    ["Доставка", "/delivery"],
    ["Самовывоз", "/pickup"],
    ["О нас", "/about"],
    ["Контакты", "/contacts"]
  ];
  return (
    <header className="site-header">
      <button className="icon-button menu-toggle" onClick={() => setOpen(!open)} aria-label="Открыть меню">
        ☰
      </button>
      <Link className="brand" to="/" aria-label="Шашлык Лайк">
        <span className="public-logo-flame" aria-hidden="true"><Flame /></span>
        <span>
          <strong>{settings.brand}</strong>
          <small>Вкус, который заслуживает лайка!</small>
        </span>
      </Link>
      <nav className={open ? "nav open" : "nav"} aria-label="Основная навигация">
        {links.map(([label, href]) => (
          <NavLink key={href} to={href} onClick={() => setOpen(false)}>{label}</NavLink>
        ))}
      </nav>
      <ThemeToggle mode={themeMode} activeTheme={activeTheme} onChange={onThemeMode} />
      <Link className="admin-icon-link" to="/admin" aria-label="Войти в админ-панель">
        <span className="user-glyph" />
      </Link>
    </header>
  );
}

function FloatingCart({ count, total, onClick }: { count: number; total: number; onClick: () => void }) {
  return (
    <button className="floating-cart" onClick={onClick} aria-label={"Открыть корзину. Товаров: " + count}>
      <span className="cart-glyph" aria-hidden="true"><i /><b /></span>
      {count > 0 && <span className="cart-count">{count}</span>}
      {total > 0 && <strong>{money(total)}</strong>}
    </button>
  );
}

function ThemeToggle({ mode, activeTheme, onChange }: { mode: ThemeMode; activeTheme: ActiveTheme; onChange: (mode: ThemeMode) => void }) {
  const nextMode: ThemeMode = mode === "auto" ? "day" : mode === "day" ? "night" : "auto";
  const title = mode === "auto" ? `Авто · сейчас ${activeTheme === "day" ? "день" : "ночь"}` : mode === "day" ? "Светлая тема" : "Ночная тема";
  return (
    <button className={`theme-toggle ${activeTheme}`} onClick={() => onChange(nextMode)} title={title} aria-label={title}>
      <span>{mode === "auto" ? "A" : activeTheme === "day" ? "☀" : "☾"}</span>
    </button>
  );
}
function Footer({ settings }: { settings: Settings }) {
  return (
    <footer className="footer">
      <div>
        <Link className="footer-brand" to="/">
          {settings.brand}
        </Link>
        <p>Ежедневно {settings.workHours}</p>
      </div>
      <div className="footer-links">
        <Link to="/menu">Меню</Link>
        <Link to="/delivery">Доставка</Link>
        <Link to="/pickup">Самовывоз</Link>
        <Link to="/contacts">Контакты</Link>
      </div>
      <div>
        <p>{settings.phone}</p>
        <p>{settings.telegramBrand}</p>
        <p>{settings.telegramOrders}</p>
      </div>
    </footer>
  );
}

type HomeProps = {
  data: Bootstrap;
  onAdd: (product: Product, quantity: number, option?: string, addons?: string[]) => void;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
  activeOrder: TrackingOrder | null;
};

const homePrimaryPhone = "+7 (909) 211-82-11";
const phoneHref = (value: string) => `tel:${value.replace(/[^+\d]/g, "")}`;

function Home({ data, onAdd, cartCount, cartTotal, onCartOpen, activeOrder }: HomeProps) {
  const activeProducts = data.products.filter((product) => product.isActive);
  const featuredProducts = activeProducts.filter((product) => product.isFeatured);
  const featured = (featuredProducts.length >= 5 ? featuredProducts : activeProducts).slice(0, 5);
  const kioskRailRef = useRef<HTMLDivElement>(null);
  const point = data.pickupPoints.find((item) => item.isActive) || {
    id: "pobedy",
    name: "ШашлычОК",
    address: "Бульвар Победы, 48А",
    phone: data.settings.phone,
    hours: "Круглосуточно",
    mapUrl: "",
    comment: "на кольце бульвара Победы",
    isActive: true
  };
  const kioskPoints = data.pickupPoints.filter((item) => item.isActive);
  const visibleKioskPoints = kioskPoints.length ? kioskPoints : [point];
  const scrollKiosks = (direction: -1 | 1) => {
    kioskRailRef.current?.scrollBy({ left: direction * kioskRailRef.current.clientWidth * 0.82, behavior: "smooth" });
  };

  return (
    <div className="home-shell">
      <HomeHeader settings={data.settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activeOrder={activeOrder} />
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-media" aria-hidden="true">
          <img src="/assets/home-hero-cinematic.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" />
        </div>
        <div className="home-hero-inner home-container">
          <div className="home-hero-copy">
            <p className="home-kicker"><Flame aria-hidden="true" /> Две сети — одна любовь</p>
            <h1 id="home-title"><span>Настоящий</span><strong>шашлык</strong></h1>
            <p className="home-hero-lead">Сочный, ароматный, на углях и любимые блюда — рядом с вами в Воронеже.</p>
            <div className="home-hero-actions">
              <Link className="home-button home-button-primary" to="/menu">Перейти в меню <ArrowRight aria-hidden="true" /></Link>
              <Link className="home-button home-button-ghost" to="/delivery"><Bike aria-hidden="true" /> Заказать доставку</Link>
            </div>
          </div>
          <div className="home-handwrite" aria-hidden="true">Готовим<br />с любовью!</div>
          <div className="home-hero-benefits" aria-label="Преимущества">
            <HomeBenefit icon={<Leaf />} title="Свежее мясо" text="каждый день" />
            <HomeBenefit icon={<Flame />} title="Настоящий жар" text="вкус на углях" />
            <HomeBenefit icon={<Target />} title="Быстрая доставка" text="по Воронежу" />
            <HomeBenefit icon={<Bike />} title="Яндекс Еда" text="и Delivery Club" />
          </div>
        </div>
        <div className="home-slide-index" aria-hidden="true"><span>01</span><i /><small>03</small></div>
        <a className="home-scroll-cue" href="#popular" aria-label="Перейти к популярным блюдам"><ChevronDown /><span>Листайте<br />вниз</span></a>
      </section>

      <div className="home-content home-container">
        <div className="home-showcase-grid">
          <section className="home-section home-popular" id="popular">
            <HomeSectionHead eyebrow="Попробуйте наши хиты" title="Популярное меню" link="/menu" linkText="Всё меню" />
            <div className="home-category-tabs" aria-label="Категории меню">
              {data.categories.slice(0, 8).map((category, index) => (
                <Link className={index === 0 ? "active" : ""} key={category.id} to={`/menu?category=${category.id}`}>{category.name}</Link>
              ))}
            </div>
            <div className="home-product-rail">
              {featured.map((product) => <HomeProductCard key={product.id} product={product} onAdd={onAdd} />)}
            </div>
          </section>

          <section className="home-promo-panel" id="promotions">
            <HomeSectionHead eyebrow="Выгодные предложения" title="Акции" link="/menu" linkText="Смотреть всё" />
            <div className="home-promo-list">
              <Link to="/menu" className="home-promo-card home-promo-card-meat">
                <span>Скоро</span><strong>Новое предложение</strong><small>Следите за обновлениями меню</small><ArrowRight />
              </Link>
              <Link to="/menu" className="home-promo-card home-promo-card-set">
                <strong>Соберите любимый заказ</strong><small>Все актуальные блюда уже в меню</small><ArrowRight />
              </Link>
            </div>
            <div className="home-pagination" aria-hidden="true"><i className="active" /><i /><i /></div>
          </section>
        </div>

        <div className="home-operations-grid">
          <section className="home-delivery-panel">
            <HomeSectionHead title="Доставка и самовывоз" link="/delivery" linkText="Подробнее" />
            <div className="home-delivery-options">
              <div><Clock3 /><span><small>Доставка курьером</small><strong>{data.settings.workHours}</strong><p>До {money(data.settings.freeDeliveryFrom)} — {money(data.settings.deliveryPrice)}<br />От {money(data.settings.freeDeliveryFrom)} — <b>бесплатно</b></p></span></div>
              <div><MapPin /><span><small>Самовывоз</small><strong>{point.address}</strong><p>{point.comment || "Заказ будет ждать вас горячим."}<br />{point.hours}</p></span></div>
              <div><Target /><span><small>Зона доставки</small><strong>Воронеж</strong><p>Правый берег и Центральный район</p></span></div>
            </div>
            <div className="home-delivery-actions">
              <Link className="home-button home-button-primary compact" to="/delivery">Заказать доставку <ArrowRight /></Link>
              <Link className="home-button home-button-ghost compact" to="/pickup">Показать точку <ArrowRight /></Link>
            </div>
          </section>

          <section className="home-kiosks">
            <HomeSectionHead title="Наши киоски" link="/pickup" linkText="Все точки" />
            <div className="home-kiosk-track" ref={kioskRailRef}>
              {visibleKioskPoints.map((kiosk) => (
                <Link className="home-kiosk-card" to="/pickup" key={kiosk.id}>
                  <img src="/assets/home-kiosk-evening.webp" alt={`Киоск ${kiosk.address}`} width="1792" height="1024" loading="lazy" decoding="async" />
                  <span><strong>{kiosk.address}</strong><small>{kiosk.comment || kiosk.hours}</small><em>{kiosk.hours}</em></span>
                  <ArrowRight />
                </Link>
              ))}
            </div>
            <div className="home-kiosk-nav">
              <button type="button" onClick={() => scrollKiosks(-1)} disabled={visibleKioskPoints.length < 2} aria-label="Предыдущие киоски"><ChevronLeft /></button>
              <div aria-hidden="true">{visibleKioskPoints.map((kiosk, index) => <i className={index === 0 ? "active" : ""} key={kiosk.id} />)}</div>
              <button type="button" onClick={() => scrollKiosks(1)} disabled={visibleKioskPoints.length < 2} aria-label="Следующие киоски"><ChevronRight /></button>
            </div>
          </section>
        </div>

        <div className="home-bottom-grid">
          <section className="home-story">
            <div className="home-story-copy"><span>О нас</span><h2>Больше чем шашлык</h2><p>Шашлык Лайк × ШашлычОК — две сети, которые объединяют любовь к настоящему шашлыку, качественному мясу и уютной атмосфере.</p><Link className="home-button home-button-primary compact" to="/about">Узнать больше <ArrowRight /></Link></div>
            <div className="home-story-facts"><HomeBenefit icon={<Flame />} title="Качество" text="вкус, который вы помните" /><HomeBenefit icon={<Leaf />} title="Натуральные продукты" text="свежее мясо и овощи" /><HomeBenefit icon={<Clock3 />} title="Опыт" text="готовим на углях" /><HomeBenefit icon={<Heart />} title="Команда" text="готовим как для себя" /></div>
            <div className="home-story-image"><img src="/assets/shashlik-hero-optimized.jpg" alt="Шашлык на металлических шампурах" width="1600" height="900" loading="lazy" decoding="async" /></div>
          </section>

          <section className="home-contact">
            <div className="home-contact-media"><img src="/assets/home-kiosk-evening.webp" alt="Киоск Шашлык Лайк вечером" width="1792" height="1024" loading="lazy" decoding="async" /></div>
            <div className="home-contact-copy"><span>Всегда рядом с вами</span><h2>Контакты</h2><div className="home-contact-list">
              {[homePrimaryPhone, formatRussianPhone(data.settings.phone)].map((phone) => <a key={phone} href={phoneHref(phone)}><Phone /><strong>{phone}</strong></a>)}
              <a href={`https://t.me/${data.settings.telegramBrand.replace("@", "")}`} target="_blank" rel="noreferrer"><Send /><strong>{data.settings.telegramBrand.toLowerCase()}</strong></a>
              <a href={`https://t.me/${data.settings.telegramOrders.replace("@", "")}`} target="_blank" rel="noreferrer"><MessageCircle /><strong>{data.settings.telegramOrders.toLowerCase()}</strong></a>
            </div></div>
          </section>
        </div>
      </div>
      <HomeFooter settings={data.settings} />
    </div>
  );
}

function HomeBenefit({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="home-benefit"><span>{icon}</span><p><strong>{title}</strong><small>{text}</small></p></div>;
}

function HomeHeader({ settings, cartCount, cartTotal, onCartOpen, activePath, activeOrder }: { settings: Settings; cartCount: number; cartTotal: number; onCartOpen: () => void; activePath?: string; activeOrder?: TrackingOrder | null }) {
  const [open, setOpen] = useState(false);
  const secondaryPhone = formatRussianPhone(settings.phone);
  const navigation = [["Меню", "/menu"], ["Акции", "#promotions"], ["Доставка", "/delivery"], ["О нас", "/about"], ["Контакты", "/contacts"]];
  return (
    <>
    <header className="home-header">
      <div className="home-header-inner home-container">
        <Link className="home-brand" to="/" aria-label="Шашлык Лайк и ШашлычОК, главная"><span className="home-brand-mark"><Flame /></span><span><strong>ШАШЛЫК <i>ЛАЙК</i> <b>×</b> ШАШЛЫЧ<i>ОК</i></strong><small>Воронеж · настоящий вкус на углях</small></span></Link>
        <nav className={open ? "home-nav open" : "home-nav"} aria-label="Навигация по сайту">
          {navigation.map(([label, href]) => href.startsWith("#") ? <a key={href} href={activePath ? `/${href}` : href} onClick={() => setOpen(false)}>{label}</a> : <Link className={activePath === href ? "active" : ""} key={href} to={href} onClick={() => setOpen(false)}>{label}</Link>)}
          <div className="home-nav-mobile-phones"><a href={phoneHref(homePrimaryPhone)}>{homePrimaryPhone}</a><a href={phoneHref(secondaryPhone)}>{secondaryPhone}</a></div>
        </nav>
        <div className="home-header-actions">
          <a className="home-phone" href={phoneHref(homePrimaryPhone)}><Phone /> <span>{homePrimaryPhone}</span></a>
          <a className="home-phone secondary" href={phoneHref(secondaryPhone)}><Phone /> <span>{secondaryPhone}</span></a>
          <button className="home-cart-button" onClick={onCartOpen} aria-label={`Открыть корзину, товаров ${cartCount}`}><ShoppingBag />{cartCount > 0 && <b>{cartCount}</b>}<span>{cartTotal > 0 ? money(cartTotal) : "Корзина"}</span></button>
          <button className="home-menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Закрыть меню" : "Открыть меню"}>{open ? <X /> : <MenuIcon />}</button>
        </div>
      </div>
    </header>
    {activeOrder && <ActiveOrderIndicator order={activeOrder} />}
    </>
  );
}

function HomeSectionHead({ eyebrow, title, link, linkText }: { eyebrow?: string; title: string; link: string; linkText: string }) {
  return <div className="home-section-head"><div>{eyebrow && <span>{eyebrow}</span>}<h2>{title}</h2></div><Link to={link}>{linkText} <ArrowRight /></Link></div>;
}

function HomeProductCard({ product, onAdd }: { product: Product; onAdd: HomeProps["onAdd"] }) {
  const [favorite, setFavorite] = useState(false);
  return (
    <article className="home-product-card">
      <div className="home-product-image"><img src={product.imageUrl} alt={product.name} width="640" height="480" loading="lazy" decoding="async" />{product.badge && <span>{product.badge}</span>}<button className={favorite ? "favorite" : ""} aria-pressed={favorite} onClick={() => setFavorite((value) => !value)} aria-label={`${favorite ? "Убрать" : "Добавить"} ${product.name} ${favorite ? "из" : "в"} избранное`}><Heart fill={favorite ? "currentColor" : "none"} /></button></div>
      <div className="home-product-info"><div><h3>{product.name}</h3><p>{product.description}</p></div><div className="home-product-buy"><span><strong>{money(product.price)}</strong><small>{product.unit}</small></span><button disabled={!product.isAvailable} onClick={() => onAdd(product, product.step || 1)} aria-label={`Добавить ${product.name} в корзину`}><Plus /></button></div></div>
    </article>
  );
}

function HomeFooter({ settings }: { settings: Settings }) {
  const secondaryPhone = formatRussianPhone(settings.phone);
  const telegramBrand = settings.telegramBrand.toLowerCase();
  const telegramOrders = settings.telegramOrders.toLowerCase();
  return (
    <footer className="home-footer"><div className="home-container"><div><Link className="home-brand" to="/"><span className="home-brand-mark"><Flame /></span><span><strong>ШАШЛЫК <i>ЛАЙК</i> × ШАШЛЫЧ<i>ОК</i></strong><small>Воронеж · настоящий вкус на углях</small></span></Link><p>Две сети — одна любовь к настоящему вкусу.</p></div><nav><strong>Навигация</strong><Link to="/menu">Меню</Link><Link to="/#promotions">Акции</Link><Link to="/delivery">Доставка</Link><Link to="/about">О нас</Link><Link to="/contacts">Контакты</Link></nav><div><strong>Контакты</strong><a href={phoneHref(homePrimaryPhone)}>{homePrimaryPhone}</a><a href={phoneHref(secondaryPhone)}>{secondaryPhone}</a><span>Ежедневно {settings.workHours}</span></div><div><strong>Мы в Telegram</strong><a href={`https://t.me/${telegramBrand.replace("@", "")}`}>{telegramBrand}</a><a href={`https://t.me/${telegramOrders.replace("@", "")}`}>{telegramOrders}</a></div></div><div className="home-footer-bottom home-container"><span>© {new Date().getFullYear()} Шашлык Лайк × ШашлычОК. Все права защищены.</span><span>Воронеж</span></div></footer>
  );
}

function CategoryBand({ categories }: { categories: Category[] }) {
  return (
    <section className="section categories">
      <SectionHead title="ЧТО БУДЕМ ЗАКАЗЫВАТЬ?" text="" />
      <div className="category-grid">
        {categories.map((category) => (
          <Link key={category.id} to={`/menu?category=${category.id}`} className="category-tile">
            <span>{category.name}</span>
            <strong>{category.minPrice}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

type MenuProps = {
  data: Bootstrap;
  onAdd: (product: Product, quantity: number, option?: string, addons?: string[]) => void;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
  activeOrder: TrackingOrder | null;
};

type MenuSort = "default" | "price-asc" | "price-desc" | "name";
type MenuView = "grid" | "list";

function Menu({ data, onAdd, cartCount, cartTotal, onCartOpen, activeOrder }: MenuProps) {
  const [params, setParams] = useSearchParams();
  const active = params.get("category") || "all";
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MenuSort>("default");
  const [view, setView] = useState<MenuView>("grid");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("menu-favorites") || "[]");
    } catch {
      return [];
    }
  });
  const catalogRef = useRef<HTMLDivElement>(null);
  const activeProducts = data.products.filter((product) => product.isActive);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const searchedProducts = activeProducts.filter((product) => !normalizedQuery || `${product.name} ${product.description}`.toLocaleLowerCase("ru").includes(normalizedQuery));
  const sortedProducts = [...searchedProducts].sort((a, b) => {
    if (sort === "price-asc") return a.price - b.price;
    if (sort === "price-desc") return b.price - a.price;
    if (sort === "name") return a.name.localeCompare(b.name, "ru");
    return a.sortOrder - b.sortOrder;
  });
  const categories = data.categories.filter((category) => activeProducts.some((product) => product.categoryId === category.id));
  const visibleCategories = active === "all" ? categories : categories.filter((category) => category.id === active);
  const featuredProducts = (activeProducts.filter((product) => product.isFeatured).length ? activeProducts.filter((product) => product.isFeatured) : activeProducts).slice(0, 3);

  useEffect(() => {
    if (active !== "all") trackEvent("category_view", { categoryId: active });
  }, [active]);

  const chooseCategory = (categoryId: string) => {
    setParams(categoryId === "all" ? {} : { category: categoryId });
    window.requestAnimationFrame(() => catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const toggleFavorite = (productId: string) => setFavorites((current) => {
    const next = current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId];
    localStorage.setItem("menu-favorites", JSON.stringify(next));
    return next;
  });
  const categoryImage = (categoryId: string) => activeProducts.find((product) => product.categoryId === categoryId)?.imageUrl || "/assets/placeholder.svg";

  return (
    <div className="menu-shell">
      <HomeHeader settings={data.settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/menu" activeOrder={activeOrder} />

      <section className="menu-hero" aria-labelledby="menu-title">
        <div className="menu-hero-media" aria-hidden="true"><img src="/assets/home-hero-cinematic.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" /></div>
        <div className="menu-hero-inner home-container">
          <div className="menu-hero-copy">
            <nav className="menu-breadcrumb" aria-label="Хлебные крошки"><Link to="/">Главная</Link><ChevronRight /><span>Меню</span></nav>
            <h1 id="menu-title">Наше <strong>меню</strong></h1>
            <p>Сочный шашлык, фирменные блюда и закуски: всё, что вы любите, в одном месте.</p>
            <div className="menu-hero-benefits" aria-label="Преимущества">
              <span><Flame /><small><b>Настоящий</b> вкус на углях</small></span>
              <span><Leaf /><small><b>Свежие</b> продукты</small></span>
              <span><Bike /><small><b>Быстрая</b> доставка</small></span>
              <span><Store /><small><b>Проверенные</b> рецепты</small></span>
            </div>
            <label className="menu-search menu-search-mobile"><Search /><span className="sr-only">Поиск блюда</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск блюда..." /><SlidersHorizontal /></label>
          </div>
        </div>
      </section>

      <section className="menu-mobile-categories home-container" aria-labelledby="mobile-categories-title">
        <div className="menu-mobile-section-head"><h2 id="mobile-categories-title">Категории</h2><button type="button" onClick={() => chooseCategory("all")}>Смотреть все <ArrowRight /></button></div>
        <div className="menu-mobile-category-list">
          {categories.map((category, index) => {
            const count = activeProducts.filter((product) => product.categoryId === category.id).length;
            return <button type="button" className={active === category.id || (active === "all" && index === 0) ? "active" : ""} key={category.id} onClick={() => chooseCategory(category.id)}><img src={categoryImage(category.id)} alt="" width="80" height="80" loading="lazy" /><strong>{category.name}</strong><span>{count}</span></button>;
          })}
        </div>
      </section>

      <div className="menu-catalog home-container" ref={catalogRef}>
        <aside className="menu-sidebar" aria-label="Категории меню">
          <div className="menu-sidebar-head"><h2>Категории</h2><button type="button" className={active === "all" ? "active" : ""} onClick={() => chooseCategory("all")}>Все</button></div>
          {categories.map((category, index) => {
            const count = activeProducts.filter((product) => product.categoryId === category.id).length;
            return <button type="button" className={active === category.id || (active === "all" && index === 0) ? "active" : ""} key={category.id} onClick={() => chooseCategory(category.id)}><img src={categoryImage(category.id)} alt="" width="56" height="56" loading="lazy" /><strong>{category.name}</strong><span>{count}</span></button>;
          })}
          <Link className="menu-sidebar-promo" to="/cart"><img src="/assets/home-hero-cinematic.webp" alt="" width="640" height="480" loading="lazy" /><span><strong>Соберите любимый заказ</strong><small>Всё актуальное меню</small></span><ArrowRight /></Link>
        </aside>

        <div className="menu-products-area">
          <div className="menu-toolbar">
            <label className="menu-search"><Search /><span className="sr-only">Поиск блюда</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск блюда..." /></label>
            <label className="menu-sort"><SlidersHorizontal /><span className="sr-only">Сортировка</span><select value={sort} onChange={(event) => setSort(event.target.value as MenuSort)}><option value="default">По умолчанию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option><option value="name">По названию</option></select><ChevronDown /></label>
            <div className="menu-view-switch" aria-label="Вид каталога"><button type="button" className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} aria-label="Показывать сеткой" onClick={() => setView("grid")}><Grid2X2 /></button><button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} aria-label="Показывать списком" onClick={() => setView("list")}><List /></button></div>
          </div>

          {active === "all" && !normalizedQuery && (
            <section className="menu-mobile-popular" aria-labelledby="mobile-popular-title">
              <div className="menu-product-section-head"><div><span>Выбор гостей</span><h2 id="mobile-popular-title">Популярное</h2></div></div>
              <div className="menu-product-grid featured">
                {featuredProducts.map((product) => <ProductCard key={`featured-${product.id}`} product={product} data={data} onAdd={onAdd} favorite={favorites.includes(product.id)} onFavorite={toggleFavorite} />)}
              </div>
            </section>
          )}

          {visibleCategories.map((category) => {
            const categoryProducts = sortedProducts.filter((product) => product.categoryId === category.id);
            if (!categoryProducts.length) return null;
            return (
              <section className={`menu-products-section category-${category.id}`} data-menu-section={category.id} key={category.id}>
                <div className="menu-product-section-head"><div><span>{category.id === "shashlik" ? "Наши хиты" : "В меню"}</span><h2>{category.name}</h2></div><small>{categoryProducts.length} {categoryProducts.length === 1 ? "блюдо" : "позиций"}</small></div>
                <div className={`menu-product-grid ${view}`}>
                  {categoryProducts.map((product) => <ProductCard key={product.id} product={product} data={data} onAdd={onAdd} favorite={favorites.includes(product.id)} onFavorite={toggleFavorite} />)}
                </div>
              </section>
            );
          })}
          {!visibleCategories.some((category) => sortedProducts.some((product) => product.categoryId === category.id)) && <EmptyProducts />}
        </div>
      </div>

      <section className="menu-footer-cta home-container"><div><span>Готовим на углях</span><h2>Закажите сейчас и наслаждайтесь настоящим вкусом</h2><Link className="home-button home-button-primary" to="/cart">Перейти в корзину <ArrowRight /></Link></div></section>
      <HomeFooter settings={data.settings} />
    </div>
  );
}

function ProductCard({ product, data, onAdd, favorite, onFavorite }: { product: Product; data: Bootstrap; onAdd: (product: Product, quantity: number, option?: string, addons?: string[]) => void; favorite: boolean; onFavorite: (productId: string) => void }) {
  const [quantity, setQuantity] = useState(product.step || 1);
  const [option, setOption] = useState(product.options?.[0] || "");
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState(false);
  const configureButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const addons = data.addons.filter((addon) => addon.isActive && (product.addonIds?.includes(addon.id) || (!product.addonIds?.length && product.addonGroup && addon.group === product.addonGroup)));
  const hasModifiers = Boolean(product.options?.length || addons.length);
  const addonTotal = selectedAddons.reduce((sum, id) => sum + (data.addons.find((addon) => addon.id === id)?.price || 0), 0);
  const linePrice = lineItemTotal(product, quantity, addonTotal);

  useEffect(() => {
    if (!configuring) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setConfiguring(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      configureButtonRef.current?.focus();
    };
  }, [configuring]);

  function addConfigured() {
    onAdd(product, quantity, option, selectedAddons);
    setConfiguring(false);
  }

  const handleAdd = () => {
    if (!product.isAvailable) return;
    if (hasModifiers) {
      trackEvent("product_view", { productId: product.id });
      setConfiguring(true);
      return;
    }
    onAdd(product, product.step || 1);
  };

  return (
    <article className={`menu-product-card${product.isAvailable ? "" : " is-unavailable"}${configuring ? " is-configuring" : ""}`} aria-disabled={!product.isAvailable || undefined}>
      <div className="product-media">
        <Link className="product-media-link" to={`/product/${product.slug}`} aria-label={`Открыть ${product.name}`}><img src={product.imageUrl || "/assets/placeholder.svg"} alt={product.name} loading="lazy" decoding="async" width="800" height="600" /></Link>
        {product.badge && <span>{product.badge}</span>}
        <button type="button" className={`menu-favorite${favorite ? " active" : ""}`} aria-pressed={favorite} onClick={() => onFavorite(product.id)} aria-label={`${favorite ? "Убрать" : "Добавить"} ${product.name} ${favorite ? "из" : "в"} избранное`}><Heart fill={favorite ? "currentColor" : "none"} /></button>
      </div>
      <div className="product-body">
        <div><h3 className="product-title" title={product.name}><Link to={`/product/${product.slug}`}>{product.name}</Link></h3><p className="product-description" title={product.description}>{product.description}</p></div>
        <div className="menu-product-buy"><small>{product.unit}</small><strong className="price">{money(product.price)}</strong><button ref={configureButtonRef} type="button" disabled={!product.isAvailable} onClick={handleAdd} aria-label={product.isAvailable ? `Добавить ${product.name} в корзину` : `${product.name} недоступен`}><Plus /></button></div>
      </div>
      {configuring && (
        <div className="configurator-shell" role="dialog" aria-modal="true" aria-labelledby={`config-title-${product.id}`}>
          <button className="configurator-backdrop" type="button" onClick={() => setConfiguring(false)} aria-label="Закрыть настройку" />
          <section className="product-configurator">
            <header>
              <div>
                <p>Настройте товар</p>
                <h2 id={`config-title-${product.id}`}>{product.name}</h2>
              </div>
              <button ref={closeButtonRef} className="configurator-close" type="button" onClick={() => setConfiguring(false)} aria-label="Закрыть">×</button>
            </header>
            <div className="configurator-content">
              {product.options?.length ? (
                <label className="configurator-field">
                  <span>Лаваш</span>
                  <select value={option} onChange={(event) => setOption(event.target.value)}>
                    {product.options.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              ) : null}
              {addons.length ? (
                <fieldset className="configurator-addons">
                  <legend>Добавки</legend>
                  {addons.map((addon) => (
                    <label key={addon.id}>
                      <input type="checkbox" checked={selectedAddons.includes(addon.id)} onChange={(event) => setSelectedAddons((current) => event.target.checked ? [...current, addon.id] : current.filter((id) => id !== addon.id))} />
                      <span>{addon.name}</span>
                      <strong>+{money(addon.price)}</strong>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
            <footer>
              <div className="configurator-total"><span>Итого</span><strong>{money(linePrice)}</strong></div>
              <button className="button primary" type="button" disabled={!product.isAvailable} onClick={addConfigured}>
                {product.isAvailable ? `ДОБАВИТЬ В КОРЗИНУ · ${money(linePrice)}` : "НЕДОСТУПНО"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </article>
  );
}

function ProductPage({ data, onAdd }: { data: Bootstrap; onAdd: (product: Product, quantity: number, option?: string, addons?: string[]) => void }) {
  const { slug = "" } = useParams();
  const product = data.products.find((item) => item.slug === slug && item.isActive);
  const [quantity, setQuantity] = useState(product?.step || 1);
  const [option, setOption] = useState(product?.options?.[0] || "");
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  useEffect(() => { if (product) trackEvent("product_view", { productId: product.id, categoryId: product.categoryId }); }, [product?.id]);
  if (!product) return <SystemState title="Товар не найден" text="Возможно, он временно отключён или удалён из меню." />;
  const addons = data.addons.filter((addon) => addon.isActive && product.addonIds?.includes(addon.id));
  const addonTotal = selectedAddons.reduce((sum, id) => sum + (data.addons.find((addon) => addon.id === id)?.price || 0), 0);
  const total = lineItemTotal(product, quantity, addonTotal);
  const related = data.products.filter((item) => item.id !== product.id && item.categoryId === product.categoryId && item.isActive).slice(0, 4);
  return <main className="product-page page">
    <nav className="menu-breadcrumb" aria-label="Хлебные крошки"><Link to="/">Главная</Link><ChevronRight /><Link to="/menu">Меню</Link><ChevronRight /><span>{product.name}</span></nav>
    <section className="product-detail">
      <div className="product-detail-media"><img src={product.imageUrl || "/assets/placeholder.svg"} alt={product.name} />{product.badge && <span>{product.badge}</span>}</div>
      <div className="product-detail-copy"><p className="eyebrow">Настоящий вкус на углях</p><h1>{product.name}</h1><p>{product.description}</p><div className="product-detail-meta"><span>{product.unit}</span><span className={product.isAvailable ? "status-pill ok" : "status-pill stop"}>{product.isAvailable ? "В наличии" : "Недоступен"}</span></div>
        {!!product.options?.length && <label>Вариант<select value={option} onChange={(event) => setOption(event.target.value)}>{product.options.map((item) => <option key={item}>{item}</option>)}</select></label>}
        {!!addons.length && <fieldset className="product-detail-addons"><legend>Добавьте к заказу</legend>{addons.map((addon) => <label key={addon.id}><input type="checkbox" checked={selectedAddons.includes(addon.id)} onChange={(event) => setSelectedAddons((current) => event.target.checked ? [...current, addon.id] : current.filter((id) => id !== addon.id))} /><span>{addon.name}</span><b>+{money(addon.price)}</b></label>)}</fieldset>}
        <div className="product-detail-buy"><Quantity value={quantity} step={product.step || 1} displayValue={formatQuantity(product, quantity)} onChange={setQuantity} /><strong>{money(total)}</strong><button className="button primary" disabled={!product.isAvailable} onClick={() => onAdd(product, quantity, option, selectedAddons)}><ShoppingBag size={19} /> Добавить в корзину</button></div>
      </div>
    </section>
    {!!related.length && <section className="product-related"><div className="section-head"><h2>Вам также может понравиться</h2></div><div className="product-related-grid">{related.map((item) => <Link key={item.id} to={`/product/${item.slug}`}><img src={item.imageUrl} alt="" /><span>{item.name}</span><b>{money(item.price)}</b></Link>)}</div></section>}
  </main>;
}

function Quantity({ value, step, displayValue, onChange }: { value: number; step: number; displayValue?: string; onChange: (value: number) => void }) {
  return (
    <div className="quantity">
      <button type="button" onClick={() => onChange(Math.max(value - step, step))} aria-label="Уменьшить количество">
        −
      </button>
      <span>{displayValue || value}</span>
      <button type="button" onClick={() => onChange(value + step)} aria-label="Увеличить количество">
        +
      </button>
    </div>
  );
}

function CartDrawer({ data, cart, open, onClose }: { data: Bootstrap; cart: ReturnType<typeof useCart>; open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-shell" role="dialog" aria-modal="true" aria-label="Корзина">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Закрыть корзину" />
      <aside className="cart-drawer">
        <button ref={closeRef} className="close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <CartContent data={data} cart={cart} compact onCheckout={onClose} />
      </aside>
    </div>
  );
}

function CartPage({ data, cart }: { data: Bootstrap; cart: ReturnType<typeof useCart> }) {
  useEffect(() => trackEvent("cart_opened", { value: cart.subtotal }), []);
  return (
    <section className="page narrow">
      <CartContent data={data} cart={cart} />
    </section>
  );
}

function CartContent({ data, cart, compact = false, onCheckout }: { data: Bootstrap; cart: ReturnType<typeof useCart>; compact?: boolean; onCheckout?: () => void }) {
  const crossSell = data.products.filter((product) => ["flatbread", "garlic-sauce", "shippi", "tomato-sauce"].includes(product.id)).slice(0, 3);
  if (!cart.detailed.length) {
    return (
      <div className="empty-cart">
        <h1>КОРЗИНА ПОКА ПУСТА</h1>
        <p>Но это легко исправить.</p>
        <Link className="button primary" to="/menu">
          СМОТРЕТЬ МЕНЮ →
        </Link>
      </div>
    );
  }
  return (
    <div className={compact ? "cart compact" : "cart"}>
      <h1>ВАШ ЗАКАЗ</h1>
      <div className="cart-items">
        {cart.detailed.map((item, index) => (
          <article key={`${item.productId}-${index}`} className="cart-row">
            <img src={item.product.imageUrl} alt="" />
            <div>
              <strong>{item.product.name}</strong>
              {item.option && <small>{item.option}</small>}
              {item.addons.length ? <small>{item.addons.map((addon) => addon.name).join(", ")}</small> : null}
              <Quantity value={item.quantity} step={item.product.step || 1} displayValue={formatQuantity(item.product, item.quantity)} onChange={(value) => cart.update(index, value)} />
            </div>
            <div className="cart-row-end">
              <strong>{money(item.lineTotal)}</strong>
              <button onClick={() => cart.remove(index)}>Удалить</button>
            </div>
          </article>
        ))}
      </div>
      <DeliveryProgress subtotal={cart.subtotal} settings={data.settings} />
      <div className="cross-sell">
        <h2>ДОБАВИТЬ К ЗАКАЗУ?</h2>
        {crossSell.map((product) => (
          <button key={product.id} onClick={() => cart.add(product, product.step || 1)}>
            <span>{product.name}</span>
            <strong>{money(product.price)}</strong>
          </button>
        ))}
      </div>
      <Totals subtotal={cart.subtotal} deliveryPrice={cart.deliveryPrice} total={cart.total} />
      <Link className="button primary full" to="/checkout" onClick={onCheckout}>
        ОФОРМИТЬ ЗАКАЗ →
      </Link>
    </div>
  );
}

function DeliveryProgress({ subtotal, settings }: { subtotal: number; settings: Settings }) {
  const remaining = Math.max(settings.freeDeliveryFrom - subtotal, 0);
  const progress = Math.min((subtotal / settings.freeDeliveryFrom) * 100, 100);
  return (
    <div className="delivery-progress">
      <strong>{remaining ? `До бесплатной доставки осталось ${money(remaining)}` : "Доставка бесплатно"}</strong>
      <div>
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>
        {money(subtotal)} / {money(settings.freeDeliveryFrom)}
      </small>
    </div>
  );
}

function Totals({ subtotal, deliveryPrice, total }: { subtotal: number; deliveryPrice: number; total: number }) {
  return (
    <div className="totals">
      <p>
        <span>Сумма товаров</span>
        <strong>{money(subtotal)}</strong>
      </p>
      <p>
        <span>Доставка</span>
        <strong>{deliveryPrice ? money(deliveryPrice) : "Бесплатно"}</strong>
      </p>
      <p>
        <span>Итого</span>
        <strong>{money(total)}</strong>
      </p>
    </div>
  );
}

function Checkout({ data, cart }: { data: Bootstrap; cart: ReturnType<typeof useCart> }) {
  const navigate = useNavigate();
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"CARD_ON_DELIVERY" | "TRANSFER_ON_DELIVERY">("CARD_ON_DELIVERY");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addressState, setAddressState] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; message: string }>({ status: "idle", message: "" });
  const [form, setForm] = useState({ customerName: "", phone: "", address: "", apartment: "", entrance: "", floor: "", intercom: "", pickupPointId: "", comment: "" });

  useEffect(() => trackEvent("checkout_started", { value: cart.total }), []);

  async function validateAddress() {
    if (!form.address.trim()) return false;
    setAddressState({ status: "checking", message: "Проверяем адрес..." });
    try {
      const response = await apiFetch("/api/address/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: form.address }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAddressState({ status: "invalid", message: payload.error || "Не удалось проверить адрес" });
        return false;
      }
      setForm((current) => ({ ...current, address: payload.address.formattedAddress }));
      setAddressState({ status: "valid", message: "Адрес найден, доставка доступна" });
      trackEvent("address_selected");
      return true;
    } catch {
      setAddressState({ status: "invalid", message: "Сервис проверки недоступен. Проверьте адрес и повторите." });
      return false;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const pickupPoint = data.pickupPoints.find((point) => point.id === form.pickupPointId);
    const payload = {
      ...form,
      deliveryType,
      paymentMethod,
      pickupPointName: pickupPoint?.name || "",
      attribution: captureAttribution(),
      analyticsSessionId: analyticsSessionId(),
      items: cart.items
    };
    try {
      const response = await apiFetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = json.error || "Не удалось отправить заказ. Попробуйте ещё раз или свяжитесь с нами в Telegram.";
        setError(message);
        trackEvent("checkout_error", { errorCode: json.code || `http_${response.status}` });
        return;
      }
      localStorage.setItem("last-order", JSON.stringify(json.order));
      try {
        const recent = JSON.parse(localStorage.getItem("recentOrders") || "[]") as Array<{ orderNumber: string; trackingToken: string }>;
        localStorage.setItem("recentOrders", JSON.stringify([json.order, ...recent.filter((item) => item.trackingToken !== json.order.trackingToken)].slice(0, 5)));
      } catch {
        localStorage.setItem("recentOrders", JSON.stringify([json.order]));
      }
      setActiveOrderToken(json.order.trackingToken);
      cart.clear();
      navigate(`/order/${json.order.trackingToken}`);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет: корзина сохранена, можно повторить отправку.");
      trackEvent("checkout_error", { errorCode: "network" });
    } finally {
      setBusy(false);
    }
  }

  if (!cart.detailed.length) return <CartPage data={data} cart={cart} />;

  return (
    <section className="page checkout">
      <div className="page-head">
        <h1>ОФОРМЛЕНИЕ ЗАКАЗА</h1>
        <p>Онлайн-оплаты нет. Заказ передаётся в обработку, оплата — при получении.</p>
      </div>
      <form className="checkout-grid" onSubmit={submit}>
        <div className="form-panel">
          <h2>Контактные данные</h2>
          <label>
            Имя
            <input required autoComplete="name" value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
          </label>
          <label>
            Телефон
            <input required inputMode="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatRussianPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" />
          </label>
          <h2>Способ получения</h2>
          <div className="segmented">
            <button type="button" className={deliveryType === "delivery" ? "active" : ""} onClick={() => setDeliveryType("delivery")}>
              Доставка
            </button>
            <button type="button" className={deliveryType === "pickup" ? "active" : ""} onClick={() => setDeliveryType("pickup")}>
              Самовывоз
            </button>
          </div>
          {deliveryType === "delivery" ? (
            <>
              <label>
                Адрес
                <input required autoComplete="street-address" value={form.address} onChange={(event) => { setForm({ ...form, address: event.target.value }); setAddressState({ status: "idle", message: "" }); }} onBlur={() => void validateAddress()} placeholder="Улица и номер дома" aria-describedby="address-help address-result" aria-invalid={addressState.status === "invalid"} />
                <small className="field-hint" id="address-help">Доставка по Воронежу. Обязательно укажите номер дома.</small>
                {addressState.message && <small id="address-result" className={`address-result ${addressState.status}`} role="status">{addressState.message}</small>}
              </label>
              <div className="address-details">
                <label>
                  Квартира
                  <input inputMode="numeric" autoComplete="address-line2" value={form.apartment} onChange={(event) => setForm({ ...form, apartment: event.target.value })} />
                </label>
                <label>
                  Подъезд
                  <input inputMode="numeric" value={form.entrance} onChange={(event) => setForm({ ...form, entrance: event.target.value })} />
                </label>
                <label>
                  Этаж
                  <input inputMode="numeric" value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} />
                </label>
                <label>
                  Домофон
                  <input value={form.intercom} onChange={(event) => setForm({ ...form, intercom: event.target.value })} />
                </label>
              </div>
            </>
          ) : (
            <label>
              Точка самовывоза
              <select value={form.pickupPointId} onChange={(event) => setForm({ ...form, pickupPointId: event.target.value })}>
                <option value="">Адреса будут добавлены через админ-панель</option>
                {data.pickupPoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.name} — {point.address || "адрес уточняется"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Комментарий
            <textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
          </label>
          <div className="payment-note">
            <strong>Способ оплаты при получении</strong>
            <div className="segmented checkout-payment-options" role="radiogroup" aria-label="Способ оплаты">
              <button type="button" role="radio" aria-checked={paymentMethod === "CARD_ON_DELIVERY"} className={paymentMethod === "CARD_ON_DELIVERY" ? "active" : ""} onClick={() => setPaymentMethod("CARD_ON_DELIVERY")}>Картой при получении</button>
              <button type="button" role="radio" aria-checked={paymentMethod === "TRANSFER_ON_DELIVERY"} className={paymentMethod === "TRANSFER_ON_DELIVERY" ? "active" : ""} onClick={() => setPaymentMethod("TRANSFER_ON_DELIVERY")}>Переводом при получении</button>
            </div>
            <p>Онлайн-оплаты на сайте нет. Мы свяжемся с вами для подтверждения заказа.</p>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary full" disabled={busy} aria-busy={busy}>
            {busy ? "ОФОРМЛЯЕМ..." : "ОФОРМИТЬ ЗАКАЗ →"}
          </button>
        </div>
        <aside className="summary-panel">
          <CartContent data={data} cart={cart} compact />
        </aside>
      </form>
    </section>
  );
}

function Success({ settings }: { settings: Settings }) {
  const [params] = useSearchParams();
  const orderNumber = params.get("order") || (() => {
    try {
      return (JSON.parse(localStorage.getItem("last-order") || "{}") as Order).orderNumber;
    } catch {
      return "";
    }
  })();
  return (
    <section className="success-page">
      <p className="eyebrow">PAY ON DELIVERY</p>
      <h1>ЗАКАЗ ПРИНЯТ</h1>
      <p>Мы получили ваш заказ и уже передали его в обработку.</p>
      <strong>Оплата производится при получении.</strong>
      {orderNumber && <div className="order-number">Номер заказа: #{orderNumber}</div>}
      <div className="hero-actions">
        <Link className="button primary" to="/menu">
          Вернуться в меню
        </Link>
        <a className="button ghost" href={`https://t.me/${settings.telegramOrders.replace("@", "")}`} target="_blank" rel="noreferrer">
          Написать в Telegram
        </a>
      </div>
    </section>
  );
}

type OrderTrackingProps = { settings: Settings; cartCount: number; cartTotal: number; onCartOpen: () => void };

function OrderStatusState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <main className="order-status-state"><span><Flame aria-hidden="true" /></span><p>Статус заказа</p><h1>{title}</h1><div>{text}</div>{action && onAction && <button type="button" onClick={onAction}><RefreshCw aria-hidden="true" /> {action}</button>}<Link to="/">Вернуться на главную <ArrowRight aria-hidden="true" /></Link></main>;
}

function orderHeroCopy(order: TrackingOrder) {
  if (order.status === "new") return { title: "Заказ", accent: "создан", lead: "Мы получили заказ. Как только команда подтвердит его, статус обновится автоматически." };
  if (["accepted", "preparing"].includes(order.status)) return { title: "Ваш заказ", accent: "готовится", lead: "Команда уже готовит ваши блюда. Здесь отображается только подтверждённый сервером статус." };
  if (order.status === "ready") return { title: "Заказ", accent: "готов", lead: order.fulfillmentType === "pickup" ? "Заказ готов к выдаче в выбранном киоске." : "Заказ приготовлен и ожидает передачи курьеру." };
  if (order.status === "delivering") return { title: "Ваш заказ", accent: "в пути", lead: "Заказ передан курьеру и направляется по адресу доставки." };
  if (order.status === "completed") return { title: "Заказ", accent: order.fulfillmentType === "pickup" ? "выдан" : "доставлен", lead: "Спасибо, что выбрали Шашлык Лайк × ШашлычОК." };
  return { title: "Заказ", accent: "отменён", lead: "Для уточнения деталей свяжитесь с нами по телефону или в Telegram." };
}

function OrderTracking({ settings, cartCount, cartTotal, onCartOpen }: OrderTrackingProps) {
  const { trackingToken = "" } = useParams();
  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "network-error" | "reconnecting">("loading");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [rating, setRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewState, setReviewState] = useState<"idle" | "sending" | "error">("idle");
  const [reviewError, setReviewError] = useState("");
  const completedTracked = useRef(false);

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(trackingToken)) {
      setState("not-found");
      return;
    }
    let active = true;
    let timer = 0;
    let hasConfirmedOrder = Boolean(order);
    trackEvent("order_tracking_opened");
    const load = async (initial = false) => {
      try {
        const response = await fetchTrackingOrder(trackingToken);
        if (response.status === 404) {
          if (active) setState("not-found");
          return;
        }
        if (!response.ok) throw new Error("network");
        const payload = await response.json() as { order: TrackingOrder };
        if (active) {
          hasConfirmedOrder = true;
          setOrder(payload.order);
          setState("ready");
          if (["completed", "cancelled"].includes(payload.order.status)) clearActiveOrderToken(trackingToken);
          else setActiveOrderToken(trackingToken);
          if (payload.order.status === "completed" && !completedTracked.current) {
            completedTracked.current = true;
            trackEvent("order_completed", { value: payload.order.total });
          }
        }
      } catch {
        if (active) setState(initial && !hasConfirmedOrder ? "network-error" : "reconnecting");
      }
    };
    void load(true);
    timer = window.setInterval(() => void load(false), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [trackingToken, reloadVersion]);

  const submitReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!order || rating < 1 || reviewState === "sending") return;
    setReviewState("sending");
    setReviewError("");
    try {
      const response = await apiFetch(`/api/orders/track/${encodeURIComponent(trackingToken)}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, comment: reviewComment }) });
      const payload = await response.json() as { order?: TrackingOrder; error?: string };
      if (!response.ok || !payload.order) throw new Error(payload.error || "Не удалось отправить отзыв");
      setOrder(payload.order);
      setReviewState("idle");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Не удалось отправить отзыв");
      setReviewState("error");
    }
  };

  const header = <HomeHeader settings={settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} />;
  if (state === "loading") return <div className="order-status-shell home-shell">{header}<OrderStatusState title="Загружаем заказ" text="Получаем последний подтверждённый статус с сервера." /></div>;
  if (state === "not-found") return <div className="order-status-shell home-shell">{header}<OrderStatusState title="Заказ не найден" text="Ссылка недействительна или заказ больше недоступен." /></div>;
  if (state === "network-error" && !order) return <div className="order-status-shell home-shell">{header}<OrderStatusState title="Нет связи" text="Не удалось загрузить заказ. Проверьте подключение и попробуйте снова." action="Повторить" onAction={() => { setState("loading"); setReloadVersion((value) => value + 1); }} /></div>;
  if (!order) return null;

  const stages = orderStages(order);
  const currentIndex = orderStageIndex(order);
  const hero = orderHeroCopy(order);
  const apartmentDetails = [order.apartment && `кв. ${order.apartment}`, order.entrance && `подъезд ${order.entrance}`, order.floor && `этаж ${order.floor}`, order.intercom && `домофон ${order.intercom}`].filter(Boolean).join(", ");
  const supportPhone = "+7 (909) 211-82-11";

  return (
    <div className={`order-status-shell home-shell status-${order.status}`}>
      {header}
      <main>
        <section className="order-status-hero" aria-labelledby="order-status-title">
          <img src="/assets/home-hero-cinematic.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" />
          <div className="order-status-hero-overlay" />
          <div className="order-status-container order-status-hero-copy">
            <p className="order-status-eyebrow"><Flame aria-hidden="true" /> Статус заказа</p>
            <h1 id="order-status-title">{hero.title}<strong>{hero.accent}</strong></h1>
            <p>{hero.lead}</p>
            <span className="order-status-handwrite" aria-hidden="true">Готовим<br />с любовью!</span>
          </div>
        </section>

        {state === "reconnecting" && <div className="order-status-offline order-status-container" role="status"><CircleAlert aria-hidden="true" /> Связь восстанавливается. Показан последний подтверждённый статус.</div>}

        <section className="order-status-tracker order-status-container" aria-label="Ход выполнения заказа" aria-live="polite">
          <div className="order-status-number">Заказ #{order.orderNumber}</div>
          {order.status === "cancelled" ? <div className="order-status-cancelled"><CircleAlert aria-hidden="true" /><span><strong>Заказ отменён</strong><small>Свяжитесь с нами, если нужна помощь.</small></span></div> : <ol>
            {stages.map((stage, index) => {
              const complete = index < currentIndex || order.status === "completed";
              const current = index === currentIndex && order.status !== "completed";
              return <li key={stage.key} className={current ? "current" : complete ? "complete" : "pending"}><i><OrderStageIcon kind={stage.kind} /></i><span><strong>{stage.label}</strong><small>{formatOrderTime(stage.timestamp)}</small></span></li>;
            })}
          </ol>}
          <div className="order-status-current"><Clock3 aria-hidden="true" /><span><small>Текущий статус</small><strong>{statusMessage(order)}</strong><b>Обновлено {formatOrderTime(order.updatedAt)}</b></span></div>
        </section>

        <section className="order-status-details order-status-container" aria-label="Детали заказа">
          <article className="order-status-card order-status-items">
            <h2><Package aria-hidden="true" /> Состав заказа</h2>
            <div className="order-status-item-list">
              {order.items.map((item, index) => <div className="order-status-item" key={`${item.productId}-${index}`}><img src={item.imageUrl || "/assets/placeholder.svg"} alt="" width="112" height="82" loading="eager" decoding="async" /><div><strong>{item.name}</strong><small>{[item.quantityLabel || `${item.quantity} шт.`, item.option, item.addons.map((addon) => addon.name).join(", ")].filter(Boolean).join(" · ")}</small></div><b>{money(item.total)}</b></div>)}
            </div>
            {order.deliveryPrice > 0 && <div className="order-status-price-row"><span>Доставка</span><b>{money(order.deliveryPrice)}</b></div>}
            <div className="order-status-total"><span>Итого</span><strong>{money(order.total)}</strong></div>
          </article>

          <article className="order-status-card order-status-delivery">
            <h2>{order.fulfillmentType === "delivery" ? <Bike aria-hidden="true" /> : <Store aria-hidden="true" />} {order.fulfillmentType === "delivery" ? "Доставка" : "Самовывоз"}</h2>
            <dl>
              <div><dt>Способ получения</dt><dd>{order.fulfillmentType === "delivery" ? "Доставка" : "Самовывоз"}</dd></div>
              {order.fulfillmentType === "delivery" ? <><div><dt>Адрес</dt><dd><MapPin aria-hidden="true" /> {order.address || "Адрес не указан"}</dd></div>{apartmentDetails && <div><dt>Детали адреса</dt><dd>{apartmentDetails}</dd></div>}</> : <div><dt>Точка выдачи</dt><dd><MapPin aria-hidden="true" /> {order.pickupPointName || "Выбранный киоск"}</dd></div>}
              {order.comment && <div><dt>Комментарий</dt><dd>{order.comment}</dd></div>}
              <div><dt>Оплата</dt><dd><WalletCards aria-hidden="true" /> {paymentMethodText(order.paymentMethod)}</dd></div>
            </dl>
          </article>

          <article className="order-status-card order-status-handoff">
            <h2>{order.fulfillmentType === "delivery" ? <UserRound aria-hidden="true" /> : <ShoppingBag aria-hidden="true" />} {order.fulfillmentType === "delivery" ? "Курьер" : "Получение"}</h2>
            <div><strong>{order.fulfillmentType === "pickup" ? (order.status === "ready" ? "Заказ можно забирать" : "Выдача в выбранном киоске") : order.status === "delivering" ? "Заказ передан курьеру" : order.status === "completed" ? "Доставка завершена" : "Курьер будет назначен после приготовления"}</strong><p>Здесь отображаются только подтверждённые данные заказа — без вымышленных имён и геопозиции.</p></div>
            <Flame className="order-status-handoff-mark" aria-hidden="true" />
          </article>
        </section>

        <section className="order-status-support order-status-container" aria-label="Помощь по заказу">
          <div><span><Phone aria-hidden="true" /></span><p><strong>Есть вопросы по заказу?</strong><small>Свяжитесь с нами — поможем в любой ситуации.</small></p></div>
          <a href={phoneHref(supportPhone)}><Phone aria-hidden="true" /> {supportPhone} <ArrowRight aria-hidden="true" /></a>
          <a className="telegram" href="https://t.me/iamartush1an" target="_blank" rel="noreferrer"><Send aria-hidden="true" /> Написать в Telegram <ArrowRight aria-hidden="true" /></a>
        </section>

        {order.status === "completed" && <section className="order-status-after order-status-container">
          <article className="order-status-thanks"><Flame aria-hidden="true" /><div><p>Спасибо, что выбираете</p><strong>Шашлык Лайк!</strong></div></article>
          <article className="order-status-review">
            <h2>Оцените заказ</h2>
            {order.review ? <div className="order-status-review-sent"><div aria-label={`Оценка ${order.review.rating} из 5`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} fill={value <= order.review!.rating ? "currentColor" : "none"} />)}</div><strong>Спасибо за отзыв!</strong>{order.review.comment && <p>{order.review.comment}</p>}</div> : order.canReview ? <form onSubmit={submitReview}><div className="order-status-stars" role="group" aria-label="Оценка заказа">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={value <= rating ? "active" : ""} onClick={() => setRating(value)} aria-label={`${value} из 5`} aria-pressed={value === rating}><Star fill={value <= rating ? "currentColor" : "none"} /></button>)}</div><textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} maxLength={500} placeholder="Поделитесь впечатлениями о блюдах и сервисе" aria-label="Комментарий к заказу" /><button className="order-status-review-submit" disabled={rating < 1 || reviewState === "sending"}>{reviewState === "sending" ? "Отправляем…" : "Отправить отзыв"}</button>{reviewError && <p className="order-status-review-error" role="alert">{reviewError}</p>}</form> : <p>Отзыв станет доступен после завершения заказа.</p>}
          </article>
        </section>}

        <div className="order-status-repeat order-status-container"><Link to="/menu">Заказать ещё <ArrowRight aria-hidden="true" /></Link></div>
      </main>
    </div>
  );
}

type DeliveryProps = {
  data: Bootstrap;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
  activeOrder: TrackingOrder | null;
};

function Delivery({ data, cartCount, cartTotal, onCartOpen, activeOrder }: DeliveryProps) {
  const { settings } = data;
  const location = useLocation();
  const kioskRailRef = useRef<HTMLDivElement>(null);
  const [activeKiosk, setActiveKiosk] = useState(0);
  const [canScrollKiosks, setCanScrollKiosks] = useState({ previous: false, next: true });
  const points = data.pickupPoints.filter((point) => point.isActive);
  const pickupPoint = points.find((point) => point.address.toLocaleLowerCase("ru-RU").includes("бульвар победы")) || points[0];
  const regionNames = settings.deliveryRegions
    .split(/\r?\n/)
    .map((region) => region.trim().replace(/\s+Воронежа$/i, ""))
    .filter(Boolean);
  const deliveryZone = regionNames.join(" и ") || "Правый берег и Центральный район";
  const aggregatorLinks = [
    { name: "Яндекс Еда", url: settings.yandexFoodUrl, className: "yandex" },
    { name: "Delivery Club", url: settings.deliveryUrl, className: "delivery-club" }
  ];

  useEffect(() => {
    if (location.hash === "#kiosks") {
      window.requestAnimationFrame(() => document.getElementById("kiosks")?.scrollIntoView({ behavior: "smooth" }));
    }
  }, [location.hash]);

  useEffect(() => {
    const update = () => updateActiveKiosk();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [points.length]);

  const scrollKiosks = (direction: -1 | 1) => {
    const rail = kioskRailRef.current;
    if (!rail) return;
    const maxScroll = Math.max(rail.scrollWidth - rail.clientWidth, 0);
    const step = points.length > 1 ? maxScroll / (points.length - 1) : maxScroll;
    rail.scrollBy({ left: direction * Math.max(step, 280), behavior: "smooth" });
  };

  const selectKiosk = (index: number) => {
    const rail = kioskRailRef.current;
    if (!rail) return;
    const maxScroll = Math.max(rail.scrollWidth - rail.clientWidth, 0);
    rail.scrollTo({ left: points.length > 1 ? (maxScroll * index) / (points.length - 1) : 0, behavior: "smooth" });
  };

  const updateActiveKiosk = () => {
    const rail = kioskRailRef.current;
    if (!rail || !rail.children.length) return;
    const maxScroll = Math.max(rail.scrollWidth - rail.clientWidth, 0);
    const progress = maxScroll > 0 ? rail.scrollLeft / maxScroll : 0;
    setActiveKiosk(Math.round(progress * Math.max(points.length - 1, 0)));
    setCanScrollKiosks({ previous: rail.scrollLeft > 2, next: rail.scrollLeft < maxScroll - 2 });
  };

  return (
    <div className="delivery-page">
      <HomeHeader settings={settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/delivery" activeOrder={activeOrder} />
      <main>
        <section className="delivery-cinematic" aria-labelledby="delivery-title">
          <div className="delivery-cinematic-media" aria-hidden="true">
            <img src="/assets/home-hero-cinematic.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" />
          </div>
          <div className="delivery-cinematic-inner home-container">
            <div className="delivery-copy">
              <p className="delivery-eyebrow">Доставка</p>
              <h1 id="delivery-title">Доставка <span>и <strong>самовывоз</strong></span></h1>
              <p className="delivery-lead">Быстро, горячо, с любовью! Доставляем ваш любимый шашлык по Правому берегу и Центральному району Воронежа.</p>
            </div>
            <p className="delivery-handwrite" aria-hidden="true">Доставим<br />горячим!</p>
            <div className="delivery-info-grid">
              <article>
                <span className="delivery-info-icon"><Bike /></span>
                <div><h2>Доставка курьером</h2><strong>{settings.workHours}</strong><p>При заказе до {money(settings.freeDeliveryFrom)} <b>{money(settings.deliveryPrice)}</b><br />При заказе от {money(settings.freeDeliveryFrom)} <b>бесплатно</b></p></div>
              </article>
              <article>
                <span className="delivery-info-icon"><ShoppingBag /></span>
                <div><h2>Самовывоз</h2><strong>{pickupPoint?.address || "Адрес уточняется"}</strong>{pickupPoint?.comment && <p>{pickupPoint.comment}<br /><b>{pickupPoint.hours || settings.workHours}</b></p>}</div>
              </article>
              <article>
                <span className="delivery-info-icon"><Target /></span>
                <div><h2>Зона доставки</h2><strong>{deliveryZone}</strong><p>Доставляем только по указанным районам Воронежа.</p></div>
              </article>
            </div>
            <div className="delivery-services">
              <p>Также вы можете<br />заказать через</p>
              {aggregatorLinks.map((service) => service.url ? (
                <a className={service.className} href={service.url} target="_blank" rel="noreferrer" key={service.name}><i />{service.name}</a>
              ) : (
                <span className={service.className} key={service.name}><i />{service.name}</span>
              ))}
              {aggregatorLinks.some((service) => service.url) && <a className="delivery-services-action" href={aggregatorLinks.find((service) => service.url)?.url} target="_blank" rel="noreferrer" aria-label="Открыть сервис доставки"><ArrowRight /></a>}
            </div>
          </div>
        </section>

        <section className="delivery-kiosks" id="kiosks" aria-labelledby="kiosks-title">
          <div className="home-container">
            <div className="delivery-kiosks-head">
              <div><p>Наши киоски</p><h2 id="kiosks-title">Наши точки <strong>в Воронеже</strong></h2><span>Всегда рядом, чтобы радовать вас настоящим шашлыком на углях.</span></div>
              {points[0] && <a href={points[0].mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent(`Воронеж, ${points[0].address}`)}`} target="_blank" rel="noreferrer"><MapPin /> Смотреть на карте <ArrowRight /></a>}
            </div>
            {points.length ? (
              <>
                <div className="delivery-kiosk-carousel">
                  <button className="delivery-carousel-arrow previous" type="button" onClick={() => scrollKiosks(-1)} disabled={!canScrollKiosks.previous} aria-label="Предыдущая точка"><ChevronLeft /></button>
                  <div className="delivery-kiosk-track" ref={kioskRailRef} onScroll={updateActiveKiosk}>
                    {points.map((point, index) => {
                      const routeUrl = point.mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent(`Воронеж, ${point.address}`)}`;
                      const isRoundTheClock = /круглосуточ|24\s*\/\s*7/i.test(point.hours);
                      return (
                        <article className={index === 0 ? "delivery-kiosk-card featured" : "delivery-kiosk-card"} key={point.id}>
                          <div className="delivery-kiosk-photo"><img src="/assets/home-kiosk-evening.webp" alt="Фирменный киоск Шашлык Лайк вечером" width="1792" height="1024" loading="lazy" decoding="async" />{isRoundTheClock && <span>24/7</span>}</div>
                          <div className="delivery-kiosk-body"><div><h3>{point.address}</h3>{point.comment && <p>{point.comment}{point.name === "ШашлычОК" ? <><br />({point.name})</> : null}</p>}</div><div className="delivery-kiosk-bottom"><span><Clock3 /> {isRoundTheClock ? "Круглосуточно" : point.hours || settings.workHours}</span><a href={routeUrl} target="_blank" rel="noreferrer">Построить маршрут <ArrowRight /></a></div></div>
                        </article>
                      );
                    })}
                  </div>
                  <button className="delivery-carousel-arrow next" type="button" onClick={() => scrollKiosks(1)} disabled={!canScrollKiosks.next} aria-label="Следующая точка"><ChevronRight /></button>
                </div>
                <div className="delivery-carousel-dots" aria-label="Навигация по точкам">{points.map((point, index) => <button type="button" className={activeKiosk === index ? "active" : ""} aria-label={`Показать точку ${point.address}`} onClick={() => selectKiosk(index)} key={point.id} />)}</div>
              </>
            ) : (
              <div className="delivery-kiosks-empty"><MapPin /><h3>Адреса уточняются</h3><p>Активные точки появятся здесь после добавления в админке.</p></div>
            )}
          </div>
        </section>
      </main>
      <HomeFooter settings={settings} />
    </div>
  );
}

type AboutProps = {
  settings: Settings;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
  activeOrder: TrackingOrder | null;
};

function About({ settings, cartCount, cartTotal, onCartOpen, activeOrder }: AboutProps) {
  const benefits = [
    {
      title: "Качество",
      text: "Вкус, который хочется повторить.",
      icon: <Beef />,
      image: "/assets/about-benefits-panorama.jpg",
      position: "left"
    },
    {
      title: "Натуральные продукты",
      text: "Свежие продукты и ингредиенты для любимых блюд.",
      icon: <Leaf />,
      image: "/assets/about-benefits-panorama.jpg",
      position: "center"
    },
    {
      title: "Опыт",
      text: "Знаем, каким должен быть настоящий вкус блюд на углях.",
      icon: <ChefHat />,
      image: "/assets/home-hero-cinematic.webp",
      position: "experience"
    },
    {
      title: "Команда",
      text: "Готовим для вас с вниманием к вкусу и качеству.",
      icon: <Users />,
      image: "/assets/about-benefits-panorama.jpg",
      position: "right"
    }
  ];

  return (
    <div className="about-page">
      <HomeHeader settings={settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/about" activeOrder={activeOrder} />
      <div className="about-content">
        <section className="about-cinematic" aria-labelledby="about-title">
          <div className="about-cinematic-media" aria-hidden="true">
            <img src="/assets/home-hero-cinematic.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" />
          </div>
          <div className="about-hero-inner home-container">
            <div className="about-copy">
              <p className="about-eyebrow">О нас</p>
              <h1 id="about-title">Больше чем <strong>шашлык</strong></h1>
              <p className="about-lead">Шашлык Лайк × ШашлычОК — две сети, которые объединяет любовь к настоящему шашлыку, качественным продуктам и вкусу блюд, приготовленных на углях.</p>
            </div>
            <p className="about-handwrite" aria-hidden="true">Настоящий<br />вкус на углях!</p>
            <div className="about-promises" aria-label="Наши принципы">
              <div><Leaf /><span><strong>Свежее</strong><small>любимые продукты</small></span></div>
              <div><Flame /><span><strong>На углях</strong><small>настоящий вкус</small></span></div>
              <div><Heart /><span><strong>С любовью</strong><small>готовим для вас</small></span></div>
            </div>
          </div>
        </section>

        <section className="about-values home-container" aria-label="Ценности бренда">
          {benefits.map((benefit) => (
            <article className={`about-value-card ${benefit.position}`} key={benefit.title}>
              <img src={benefit.image} alt="" width="1800" height="600" loading="lazy" decoding="async" />
              <div><span className="about-value-icon">{benefit.icon}</span><h2>{benefit.title}</h2><p>{benefit.text}</p></div>
            </article>
          ))}
        </section>

        <figure className="about-brand-photo">
          <div className="about-photo-frame"><img src="/assets/home-kiosk-evening.webp" alt="Брендированная визуализация фирменной точки" width="1792" height="1024" loading="lazy" decoding="async" /><i aria-hidden="true" /><b aria-hidden="true" /></div>
          <figcaption>Фирменный образ точки</figcaption>
          <p aria-hidden="true">Всегда рады<br />вас видеть!</p>
          <div className="about-stamp" aria-label="Шашлык Лайк и ШашлычОК, Воронеж">
            <svg viewBox="0 0 180 180" aria-hidden="true"><defs><path id="about-stamp-path" d="M 24 90 A 66 66 0 1 1 156 90 A 66 66 0 1 1 24 90" /></defs><circle cx="90" cy="90" r="73" /><text><textPath href="#about-stamp-path" startOffset="2%">ШАШЛЫК ЛАЙК × ШАШЛЫЧОК • ВОРОНЕЖ • </textPath></text></svg>
            <Flame aria-hidden="true" />
          </div>
        </figure>

      </div>
      <HomeFooter settings={settings} />
    </div>
  );
}

type ContactsProps = {
  data: Bootstrap;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
  activeOrder: TrackingOrder | null;
};

function Contacts({ data, cartCount, cartTotal, onCartOpen, activeOrder }: ContactsProps) {
  const { settings } = data;
  const points = data.pickupPoints.filter((point) => point.isActive);
  const pickupPoint = points.find((point) => point.address.toLocaleLowerCase("ru-RU").includes("бульвар победы")) || points[0];
  const deliveryZone = settings.deliveryRegions
    .split(/\r?\n/)
    .map((region) => region.trim().replace(/\s+Воронежа$/i, ""))
    .filter(Boolean)
    .join(" и ") || "Правый берег и Центральный район";
  const secondaryPhone = formatRussianPhone(settings.phone);
  const telegramChannel = settings.telegramBrand.toLowerCase();
  const telegramSupport = settings.telegramOrders.toLowerCase();
  const mapHref = points[0]?.mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent("Шашлык Лайк ШашлычОК Воронеж")}`;

  return (
    <div className="contacts-page">
      <HomeHeader settings={settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/contacts" activeOrder={activeOrder} />
      <main>
        <section className="contacts-hero" aria-labelledby="contacts-title">
          <div className="contacts-hero-media" aria-hidden="true"><img src="/assets/home-kiosk-evening.webp" alt="" width="1792" height="1024" fetchPriority="high" decoding="async" /></div>
          <div className="contacts-hero-inner home-container">
            <div className="contacts-intro">
              <p className="contacts-eyebrow">Контакты</p>
              <h1 id="contacts-title">Всегда <strong>на связи</strong></h1>
              <p>Отвечаем на вопросы, принимаем заказы и ждём вас в наших киосках в Воронеже.</p>
            </div>
            <p className="contacts-handwrite" aria-hidden="true">Ждём вас в наших<br />киосках!</p>
            <div className="contacts-actions" aria-label="Способы связи">
              <a href={phoneHref(homePrimaryPhone)}><span className="contacts-action-icon"><Phone /></span><span><small>Заказы и доставка</small><strong>{homePrimaryPhone}</strong></span><ArrowRight /></a>
              <a href={phoneHref(secondaryPhone)}><span className="contacts-action-icon"><Phone /></span><span><small>Вопросы и поддержка</small><strong>{secondaryPhone}</strong></span><ArrowRight /></a>
              <a className="telegram" href={`https://t.me/${telegramChannel.replace("@", "")}`} target="_blank" rel="noreferrer"><span className="contacts-action-icon"><Send /></span><span><small>Наш канал в Telegram</small><strong>{telegramChannel}</strong></span><ArrowRight /></a>
              <a className="telegram" href={`https://t.me/${telegramSupport.replace("@", "")}`} target="_blank" rel="noreferrer"><span className="contacts-action-icon"><MessageCircle /></span><span><small>Поддержка в Telegram</small><strong>{telegramSupport}</strong></span><ArrowRight /></a>
            </div>
          </div>
        </section>

        <section className="contacts-logistics home-container" aria-label="Доставка, самовывоз и карта">
          <div className="contacts-delivery-grid">
            <article><span className="contacts-info-icon"><Clock3 /></span><div><h2>Доставка курьером</h2><strong>{settings.workHours}</strong><p>При заказе до {money(settings.freeDeliveryFrom)} <b>{money(settings.deliveryPrice)}</b><br />При заказе от {money(settings.freeDeliveryFrom)} <b>бесплатно</b></p></div></article>
            <article><span className="contacts-info-icon"><ShoppingBag /></span><div><h2>Самовывоз</h2><strong>{pickupPoint?.address || "Адрес уточняется"}</strong><p>{pickupPoint?.comment || "Комментарий к адресу уточняется"}{pickupPoint?.name === "ШашлычОК" ? <><br />({pickupPoint.name})</> : null}<br /><b>{pickupPoint?.hours || settings.workHours}</b></p></div></article>
            <article><span className="contacts-info-icon"><Target /></span><div><h2>Зона доставки</h2><strong>{deliveryZone}</strong><p>Доставляем только по указанным районам Воронежа.</p></div></article>
          </div>
          <a className="contacts-map" href={mapHref} target="_blank" rel="noreferrer" aria-label="Открыть подтверждённые адреса киосков в Яндекс Картах">
            <div className="contacts-map-top"><span><MapPin /> Наши киоски на карте</span><ArrowRight /></div>
            <div className="contacts-map-lines" aria-hidden="true"><i /><i /><i /><i /><b /><b /><b /><b /></div>
            <div className="contacts-map-copy"><strong>Воронеж</strong><span>Открыть подтверждённые адреса в Яндекс Картах</span></div>
          </a>
        </section>

        <section className="contacts-kiosks" aria-labelledby="contacts-kiosks-title">
          <div className="home-container">
            <div className="contacts-kiosks-head"><div><p>Наши киоски</p><h2 id="contacts-kiosks-title">Наши киоски</h2><span>Выберите ближайшую точку и постройте маршрут.</span></div><a href={mapHref} target="_blank" rel="noreferrer">Смотреть все <ArrowRight /></a></div>
            <div className="contacts-kiosk-grid">
              {points.map((point, index) => {
                const routeUrl = point.mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent(`Воронеж, ${point.address}`)}`;
                const isRoundTheClock = /круглосуточ|24\s*\/\s*7/i.test(point.hours);
                return (
                  <article className={index === 0 ? "contacts-kiosk-card featured" : "contacts-kiosk-card"} key={point.id}>
                    <div className="contacts-kiosk-photo"><img src="/assets/home-kiosk-evening.webp" alt="Брендированная визуализация фирменной точки" width="1792" height="1024" loading="lazy" decoding="async" /><small>Фирменная визуализация</small>{isRoundTheClock && <span>24/7</span>}</div>
                    <div className="contacts-kiosk-body"><h3>{point.address}</h3>{point.comment && <p>{point.comment}{point.name === "ШашлычОК" ? <><br />({point.name})</> : null}</p>}<div><span><Clock3 /> {isRoundTheClock ? "Круглосуточно" : point.hours || settings.workHours}</span><a href={routeUrl} target="_blank" rel="noreferrer">Построить маршрут <ArrowRight /></a></div></div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>
      <HomeFooter settings={settings} />
    </div>
  );
}

function AggregatorBlock({ settings }: { settings: Settings }) {
  return (
    <section className="section aggregators">
      <SectionHead title="ЗАКАЗЫВАЙ ТАМ, ГДЕ ТЕБЕ УДОБНО" text="" />
      <div className="aggregator-grid">
        <article>
          <h3>Яндекс Еда</h3>
          <p>Заказывай Шашлык Лайк через приложение Яндекс Еда.</p>
          {settings.yandexFoodUrl ? <a className="button ghost" href={settings.yandexFoodUrl}>ЗАКАЗАТЬ В ЯНДЕКС ЕДЕ</a> : <button disabled>Ссылка появится позже</button>}
        </article>
        <article>
          <h3>Delivery</h3>
          <p>Наше меню также доступно в Delivery.</p>
          {settings.deliveryUrl ? <a className="button ghost" href={settings.deliveryUrl}>ЗАКАЗАТЬ В DELIVERY</a> : <button disabled>Ссылка появится позже</button>}
        </article>
      </div>
    </section>
  );
}

function can(admin: AdminBootstrap, permission: string) {
  return admin.permissions.includes(permission);
}

function Admin({ onChanged, themeMode, activeTheme, onThemeMode }: { onChanged: () => void; themeMode: ThemeMode; activeTheme: ActiveTheme; onThemeMode: (mode: ThemeMode) => void }) {
  const [token, setToken] = useState(localStorage.getItem("admin-token") || "");
  const [loginName, setLoginName] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [admin, setAdmin] = useState<AdminBootstrap | null>(null);
  const [tab, setTab] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [success, setSuccess] = useState("");

  async function load(nextToken = token) {
    try {
      const response = await apiFetch("/api/admin/bootstrap", { headers: { authorization: `Bearer ${nextToken}` } });
      if (response.status === 401 || response.status === 403) {
        setToken("");
        setAdmin(null);
        localStorage.removeItem("admin-token");
        setError("Сессия завершена. Войдите снова.");
        return false;
      }
      if (!response.ok) throw new Error("Admin API unavailable");
      setAdmin(await response.json());
      return true;
    } catch {
      setError("Нет связи с сервером админки. Проверьте API и повторите.");
      return false;
    }
  }

  useEffect(() => {
    if (token) void load(token);
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: loginName, password })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || "Не удалось войти");
        return;
      }
      localStorage.setItem("admin-token", json.token);
      setToken(json.token);
      await load(json.token);
    } catch {
      setError("Нет связи с сервером. Проверьте адрес API и CORS.");
    } finally {
      setBusy(false);
    }
  }

  async function authorized(url: string, init: RequestInit = {}) {
    setError("");
    setSuccess("");
    try {
      const response = await apiFetch(url, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        setError(json.error || "Не удалось сохранить изменения");
        await load();
        return;
      }
      await load();
      onChanged();
      setSuccess("Изменения сохранены");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch {
      setError("Изменения не сохранены: нет связи с сервером.");
    }
  }

  async function uploadImage(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Используйте PNG, JPG или WebP до 5 МБ");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
      reader.readAsDataURL(file);
    });
    const response = await apiFetch("/api/admin/uploads", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ dataUrl }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить изображение");
    return String(payload.url);
  }

  function logout() {
    localStorage.removeItem("admin-token");
    setToken("");
    setAdmin(null);
  }

  if (!token || !admin) {
    return (
      <section className="admin-login">
        <div className="admin-login-theme"><ThemeToggle mode={themeMode} activeTheme={activeTheme} onChange={onThemeMode} /></div>
        <form onSubmit={login}>
          <div className="admin-login-brand">
            <span className="admin-flame-mark"><Flame aria-hidden="true" /></span>
            <span>Шашлык Лайк</span>
          </div>
          <h1>АДМИН-ПАНЕЛЬ</h1>
          <p>Вход для сотрудников: логин и пароль. Локальный владелец: login admin, пароль из .env.</p>
          <label>
            Логин
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="admin" />
          </label>
          <label>
            Пароль
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary" disabled={busy} aria-busy={busy}>{busy ? "Входим..." : "Войти"}</button>
        </form>
      </section>
    );
  }

  const tabs = [
    ["dashboard", "Главная", "⌂"],
    ["orders", "Заказы", "▣"],
    ["products", "Меню / Товары", "▦"],
    ["categories", "Категории", "◫"],
    ["addons", "Дополнения", "+"],
    ["pickup", "Киоски", "⌂"],
    ["clients", "Клиенты", "♡"],
    ["users", "Сотрудники", "◎"],
    ["analytics", "Аналитика", "↗"],
    ["profile", "Профиль", "◉"],
    ["settings", "Настройки", "⚙"]
  ].filter(([id]) => (id !== "settings" || can(admin, "settings.manage")) && (id !== "analytics" || can(admin, "analytics.basic")));
  const currentName = userName(admin.currentUser);

  return (
    <section className="admin admin-shell">
      {navOpen && <button className="admin-nav-backdrop" aria-label="Закрыть меню" onClick={() => setNavOpen(false)} />}
      <aside className={`admin-nav ${navOpen ? "open" : ""}`} aria-label="Разделы админ-панели">
        <button className="admin-nav-close" type="button" aria-label="Закрыть меню" onClick={() => setNavOpen(false)}>×</button>
        <div className="admin-product-brand"><span className="admin-flame-mark"><Flame aria-hidden="true" /></span><span><strong>ШАШЛЫК <b>ЛАЙК</b></strong><small>Админ-панель</small></span></div>
        <div className="admin-nav-brand employee-brand">
          <div className="admin-avatar small">{admin.currentUser.avatarUrl ? <img src={admin.currentUser.avatarUrl} alt="" /> : <span>{currentName.slice(0, 1)}</span>}</div>
          <span>
            <strong>{currentName}</strong>
            <small>{admin.currentUser.position || roleLabel(admin.currentUser.role)}</small>
          </span>
        </div>
        <div className="admin-nav-list">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setNavOpen(false); setQuery(""); }}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <button className="admin-logout" onClick={logout}>Выйти</button>
      </aside>
      <div className="admin-work">
        <div className="admin-topbar">
          <button className="admin-mobile-menu" type="button" aria-label="Открыть меню" onClick={() => setNavOpen(true)}>☰</button>
          <label className="admin-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск в текущем разделе..." aria-label="Поиск" /></label>
          <div className="admin-top-actions">
            <ThemeToggle mode={themeMode} activeTheme={activeTheme} onChange={onThemeMode} />
            <span className="admin-clock">{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</span>
            <div className="admin-avatar">{admin.currentUser.avatarUrl ? <img src={admin.currentUser.avatarUrl} alt="" /> : <span>{currentName.slice(0, 1)}</span>}</div>
          </div>
        </div>
        {error && <p className="form-error admin-error">{error}</p>}
        {success && <p className="admin-success" role="status">{success}</p>}
        {tab === "dashboard" && <AdminDashboard admin={admin} />}
        {tab === "analytics" && <AdminAnalytics admin={admin} />}
        {tab === "orders" && <AdminOrders admin={admin} save={authorized} query={query} />}
        {tab === "products" && <AdminProducts admin={admin} save={authorized} uploadImage={uploadImage} query={query} />}
        {tab === "categories" && <AdminCategories admin={admin} save={authorized} query={query} />}
        {tab === "addons" && <AdminAddons admin={admin} save={authorized} uploadImage={uploadImage} query={query} />}
        {tab === "pickup" && <AdminPickup admin={admin} save={authorized} uploadImage={uploadImage} query={query} />}
        {tab === "clients" && <AdminClients admin={admin} query={query} />}
        {tab === "users" && <AdminUsers admin={admin} save={authorized} uploadImage={uploadImage} query={query} />}
        {tab === "profile" && <AdminProfile admin={admin} save={authorized} uploadImage={uploadImage} />}
        {tab === "settings" && <AdminSettings admin={admin} save={authorized} />}
      </div>
    </section>
  );
}

function AdminProfile({ admin, save, uploadImage }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; uploadImage: (file: File) => Promise<string> }) {
  const [profile, setProfile] = useState(admin.currentUser);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => setProfile(admin.currentUser), [admin.currentUser.id, admin.currentUser.updatedAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save(`/api/admin/users/${admin.currentUser.id}`, { method: "PUT", body: JSON.stringify(profile) });
  }

  async function setProfileImage(file: File) {
    try {
      setUploadError("");
      const avatarUrl = await uploadImage(file);
      setProfile((current) => ({ ...current, avatarUrl }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Ошибка загрузки");
    }
  }

  return (
    <>
      <div className="admin-section-title"><h2>Профиль</h2><p>Эти данные видят сотрудники в справочнике команды.</p></div>
      <form className="admin-form admin-card-form profile-form" onSubmit={submit}>
        <div className="profile-photo-row">
          <div className="admin-avatar profile-photo">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{userName(profile).slice(0, 1)}</span>}</div>
          <label className="file-field">
            Фото профиля
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void setProfileImage(event.target.files[0])} />
          </label>
        </div>
        {uploadError && <p className="form-error">{uploadError}</p>}
        <div className="two-fields">
          <input value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} placeholder="Имя" required />
          <input value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} placeholder="Фамилия" required />
        </div>
        <input inputMode="tel" value={profile.phone || ""} onChange={(event) => setProfile({ ...profile, phone: formatRussianPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" />
        <div className="two-fields">
          <select value={profile.workPointId || ""} onChange={(event) => setProfile({ ...profile, workPointId: event.target.value })}>
            <option value="">Точка не выбрана</option>
            {admin.pickupPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
          </select>
          <select value={profile.shiftType || "DAY"} onChange={(event) => setProfile({ ...profile, shiftType: event.target.value as ShiftType })}>
            <option value="DAY">Дневная смена · 09:00–21:00</option>
            <option value="NIGHT">Ночная смена · 21:00–09:00</option>
          </select>
        </div>
        <button className="button primary">Сохранить профиль</button>
      </form>
    </>
  );
}
function AdminDashboard({ admin }: { admin: AdminBootstrap }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = admin.orders.filter((order) => order.createdAt.startsWith(today));
  const cancelledOrders = admin.orders.filter((order) => order.status === "cancelled");
  const revenue = todayOrders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + order.total, 0);
  const lostRevenue = cancelledOrders.reduce((sum, order) => sum + order.total, 0);
  const avg = admin.orders.length ? Math.round(admin.orders.reduce((sum, order) => sum + order.total, 0) / admin.orders.length) : 0;
  const productCounts = new Map<string, number>();
  admin.orders.forEach((order) => order.items.forEach((item) => productCounts.set(item.name, (productCounts.get(item.name) || 0) + item.quantity)));
  const popular = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Пока нет данных";
  const telegram = admin.orders.find((order) => order.telegram)?.telegram;

  return (
    <div className="admin-dashboard">
      <AdminSectionHero eyebrow="Добро пожаловать" title={userName(admin.currentUser).toUpperCase()} text="Здесь вы управляете заказами, меню, сотрудниками и всеми процессами заведения." />
      <div className="metric-grid">
        <Metric label="Заказы сегодня" value={todayOrders.length} />
        {can(admin, "analytics.basic") && <Metric label="Средний чек" value={money(avg)} />}
        {can(admin, "analytics.basic") && <Metric label="Отменено" value={cancelledOrders.length} />}
        {can(admin, "analytics.financial") && <Metric label="Упущенная выгода" value={money(lostRevenue)} />}
        {can(admin, "analytics.financial") && <Metric label="Выручка сегодня" value={money(revenue)} highlight />}
      </div>
      {can(admin, "analytics.basic") ? (
        <div className="admin-insight-grid">
          <article className="admin-panel-card wide">
            <span>Популярный товар</span>
            <strong>{popular}</strong>
            <p>Показывается по фактическим позициям в заказах.</p>
          </article>
          <article className="admin-panel-card">
            <span>Telegram</span>
            <strong>{telegram?.sent ? "Работает" : telegramReasonText(telegram?.reason)}</strong>
            <p>Новые заказы должны приходить в рабочий чат.</p>
          </article>
        </div>
      ) : (
        <article className="admin-panel-card wide">
          <span>Доступ сотрудника</span>
          <strong>Активные заказы и рабочие действия</strong>
          <p>Финансовая статистика скрыта для этой роли.</p>
        </article>
      )}
      <div className="admin-dashboard-grid">
        <section className="admin-dashboard-orders"><div className="admin-section-title compact"><h3>Последние заказы</h3><p>Только реальные записи из базы</p></div><div className="admin-table order-table dashboard-order-table">{admin.orders.slice(0, 6).map((order) => <article key={order.id}><div><strong>#{order.orderNumber}</strong><p>{order.customerName} · {order.items.map((item) => item.name).join(", ")}</p></div><b>{money(order.total)}</b><span className={`status-pill status-${order.status}`}>{admin.orderStatusLabels[order.status]}</span></article>)}{!admin.orders.length && <AdminEmpty title="Заказов пока нет" text="Новые заказы появятся здесь автоматически." />}</div></section>
        <aside className="admin-status-summary"><div className="admin-section-title compact"><h3>Статусы сегодня</h3></div><div className="admin-status-ring"><strong>{todayOrders.length}</strong><span>всего</span></div><ul>{admin.orderStatuses.map((status) => <li key={status}><span>{admin.orderStatusLabels[status]}</span><b>{todayOrders.filter((order) => order.status === status).length}</b></li>)}</ul></aside>
      </div>
    </div>
  );
}

function AdminAnalytics({ admin }: { admin: AdminBootstrap }) {
  const analytics = admin.analyticsSummary;
  if (!analytics) return <div className="placeholder-panel"><h2>Нет доступа</h2><p>Аналитика недоступна для этой роли.</p></div>;
  const funnel = [
    ["Посетили сайт", analytics.funnel.page_view || 0],
    ["Открыли меню", analytics.funnel.menu_view || 0],
    ["Добавили товар", analytics.funnel.add_to_cart || 0],
    ["Начали оформление", analytics.funnel.checkout_started || 0],
    ["Создали заказ", analytics.funnel.order_created || 0]
  ] as const;
  return (
    <div className="admin-dashboard">
      <div className="admin-section-title"><h2>Аналитика</h2><p>События не содержат имя, телефон, адрес или tracking-токен.</p></div>
      <div className="metric-grid analytics-metrics">
        <Metric label="Сессии" value={analytics.sessions} />
        <Metric label="События" value={analytics.events} />
        <Metric label="Ошибки checkout" value={analytics.checkoutErrors} />
      </div>
      <section className="admin-analytics-section">
        <div className="admin-section-title compact"><h3>Воронка</h3><p>Уникальные сессии на каждом этапе.</p></div>
        <div className="analytics-funnel">
          {funnel.map(([label, value], index) => <article key={label}><small>{String(index + 1).padStart(2, "0")}</small><strong>{value}</strong><span>{label}</span></article>)}
        </div>
      </section>
      <section className="admin-analytics-section">
        <div className="admin-section-title compact"><h3>Источники заказов</h3><p>UTM source, referral или direct.</p></div>
        <div className="admin-table analytics-source-table">
          {analytics.sources.length ? analytics.sources.map((source) => <article key={source.source}><strong>{source.source || "direct"}</strong><span>{source.orders} заказов</span>{typeof source.revenue === "number" && <b>{money(source.revenue)}</b>}</article>) : <p>Заказы с атрибуцией пока не накоплены.</p>}
        </div>
      </section>
    </div>
  );
}
function Metric({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <article className={highlight ? "metric highlight" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminOrders({ admin, save, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; query: string }) {
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = admin.orders.filter((order) => {
    const matchesStatus = status === "all" || order.status === status;
    const haystack = `${order.orderNumber} ${order.customerName} ${order.phone} ${order.address} ${order.items.map((item) => item.name).join(" ")}`.toLowerCase();
    return matchesStatus && (!normalized || haystack.includes(normalized));
  });
  return (
    <>
      <AdminSectionHero eyebrow="Управление заказами" title="ЗАКАЗЫ" text="Принимайте и контролируйте реальные заказы. Статусы синхронизируются с клиентской страницей." />
      <div className="admin-filter-row" aria-label="Фильтр заказов">
        <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>Все <b>{admin.orders.length}</b></button>
        {admin.orderStatuses.map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{admin.orderStatusLabels[item]} <b>{admin.orders.filter((order) => order.status === item).length}</b></button>)}
      </div>
      <div className="admin-table order-table">
        {!filtered.length && <AdminEmpty title="Заказов не найдено" text="Измените фильтр или поисковый запрос." />}
        {filtered.map((order) => (
          <article key={order.id} className={order.status === "new" ? "is-new" : ""} onClick={() => setSelected(order)}>
            <div>
              <strong>#{order.orderNumber}</strong>
              <p>{new Date(order.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {order.customerName}</p>
              <p>{order.phone} · {order.deliveryType === "pickup" ? "Самовывоз" : "Доставка"}</p>
              <p>{order.items.map((item) => `${item.name} · ${item.quantityLabel || item.quantity}`).join(", ")}</p>
              {order.telegram && <small>Telegram: {order.telegram.sent ? "отправлено" : telegramReasonText(order.telegram.reason)}</small>}
            </div>
            {can(admin, "analytics.financial") && <strong>{money(order.total)}</strong>}
            <select aria-label={`Статус заказа ${order.orderNumber}`} value={order.status} disabled={!can(admin, "orders.change_status") || !order.availableTransitions.length} onClick={(event) => event.stopPropagation()} onChange={(event) => save(`/api/admin/orders/${order.id}`, { method: "PUT", body: JSON.stringify({ status: event.target.value, expectedStatus: order.status }) })}>
              <option value={order.status}>{orderStatusMeta[order.status].label}</option>
              {order.availableTransitions.map((status) => <option key={status} value={status}>{orderStatusMeta[status].label}</option>)}
            </select>
            <button type="button" onClick={(event) => { event.stopPropagation(); setSelected(order); }}>Открыть</button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label={`Заказ ${selected.orderNumber}`}>
          <button className="admin-editor-backdrop" aria-label="Закрыть" onClick={() => setSelected(null)} />
          <aside className="admin-editor order-editor">
            <button className="admin-editor-close" type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            <div className="admin-section-title compact"><h3>#{selected.orderNumber}</h3><p>{new Date(selected.createdAt).toLocaleString("ru-RU")}</p></div>
            <span className={`status-pill status-${selected.status}`}>{admin.orderStatusLabels[selected.status]}</span>
            <section><h4>Клиент</h4><p><b>{selected.customerName}</b><br /><a href={`tel:${selected.phone}`}>{selected.phone}</a></p></section>
            <section><h4>Состав заказа</h4>{selected.items.map((item, index) => <div className="order-detail-line" key={`${item.name}-${index}`}><span>{item.name}<small>{item.quantityLabel || `${item.quantity} ${item.unit}`}{item.option ? ` · ${item.option}` : ""}{item.addons.length ? ` · ${item.addons.map((addon) => addon.name).join(", ")}` : ""}</small></span><b>{money(item.total)}</b></div>)}<div className="order-detail-total"><span>Итого</span><b>{money(selected.total)}</b></div></section>
            <section><h4>{selected.deliveryType === "pickup" ? "Самовывоз" : "Доставка"}</h4><p>{selected.deliveryType === "pickup" ? selected.pickupPointName || "Точка не указана" : selected.address || "Адрес не указан"}</p>{selected.deliveryType === "delivery" && <p className="muted">Подъезд {selected.entrance || "—"} · этаж {selected.floor || "—"} · квартира {selected.apartment || "—"} · домофон {selected.intercom || "—"}</p>}{selected.comment && <p>Комментарий: {selected.comment}</p>}<p>Оплата: {paymentMethodText(selected.paymentMethod)}</p></section>
            <section><h4>История статусов</h4><ol className="admin-history">{admin.orderStatusHistory.filter((entry) => entry.orderId === selected.id).map((entry) => <li key={entry.id}><span>{admin.orderStatusLabels[entry.toStatus]}</span><small>{new Date(entry.changedAt).toLocaleString("ru-RU")} · {entry.source === "telegram" ? "Telegram" : entry.source === "admin" ? "Админка" : "Система"}</small></li>)}</ol></section>
          </aside>
        </div>
      )}
    </>
  );
}

function AdminProducts({ admin, save, uploadImage, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; uploadImage: (file: File) => Promise<string>; query: string }) {
  const blank: Product = { id: "", slug: "", name: "", description: "", price: 0, unit: "1 шт", step: 1, categoryId: admin.categories[0]?.id || "shashlik", imageUrl: "/assets/placeholder.svg", isActive: true, isAvailable: true, isFeatured: false, options: [], addonIds: [], sortOrder: 999 };
  const [editing, setEditing] = useState<Product>(blank);
  const editable = can(admin, "products.edit");
  const [editorOpen, setEditorOpen] = useState(false);
  const [uploadError, setUploadError] = useState("");

  function toggleProductAddon(addonId: string) {
    setEditing((current) => ({
      ...current,
      addonIds: current.addonIds?.includes(addonId)
        ? current.addonIds.filter((id) => id !== addonId)
        : [...(current.addonIds || []), addonId]
    }));
  }

  async function handleImage(file: File) {
    setUploadError("");
    try {
      const imageUrl = await uploadImage(file);
      setEditing((current) => ({ ...current, imageUrl }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить фото");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editable) return;
    const isNew = !editing.id;
    await save(isNew ? "/api/admin/products" : `/api/admin/products/${editing.id}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(editing) });
    setEditing(blank);
    setEditorOpen(false);
  }

  const normalized = query.trim().toLowerCase();
  const products = admin.products.filter((product) => !normalized || `${product.name} ${product.description} ${admin.categories.find((category) => category.id === product.categoryId)?.name || ""}`.toLowerCase().includes(normalized));

  return (
    <>
      <AdminSectionHero eyebrow="Управление меню" title="МЕНЮ / ТОВАРЫ" text="Доступность, цены и хиты сразу отражаются на витрине." action={editable ? <button className="button primary" onClick={() => { setEditing(blank); setEditorOpen(true); }}><Plus size={18} /> Добавить товар</button> : undefined} />
      {editable && editorOpen && (
        <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label={editing.id ? "Редактирование товара" : "Добавление товара"}>
          <button className="admin-editor-backdrop" aria-label="Закрыть" onClick={() => setEditorOpen(false)} />
        <form className="admin-form admin-card-form admin-editor" onSubmit={submit}>
          <button className="admin-editor-close" type="button" aria-label="Закрыть" onClick={() => setEditorOpen(false)}>×</button>
          <div className="admin-section-title compact"><h3>{editing.id ? "Редактировать товар" : "Новый товар"}</h3><p>Все поля сохраняются на сервере.</p></div>
          <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Название" required />
          <input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} placeholder="slug" />
          <textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} placeholder="Описание" />
          <div className="two-fields">
            <input type="number" value={editing.price} onChange={(event) => setEditing({ ...editing, price: Number(event.target.value) })} placeholder="Цена" />
            <input value={editing.unit} onChange={(event) => setEditing({ ...editing, unit: event.target.value })} placeholder="Единица" />
          </div>
<select value={editing.categoryId} onChange={(event) => setEditing({ ...editing, categoryId: event.target.value })}>{admin.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <label className="admin-wide-field">Варианты выбора
            <input value={(editing.options || []).join(", ")} onChange={(event) => setEditing({ ...editing, options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Стандартный лаваш, Сырный лаваш" />
          </label>
          <fieldset className="admin-addon-picker">
            <legend>Дополнения-чекбоксы для этой позиции</legend>
            {admin.addons.map((addon) => (
              <label key={addon.id}><input type="checkbox" checked={Boolean(editing.addonIds?.includes(addon.id))} onChange={() => toggleProductAddon(addon.id)} /> {addon.name} · {money(addon.price)}</label>
            ))}
            {!admin.addons.length && <p>Сначала добавьте дополнение ниже.</p>}
          </fieldset>
          <input value={editing.imageUrl} onChange={(event) => setEditing({ ...editing, imageUrl: event.target.value })} placeholder="URL фото" />
          {editing.imageUrl && <img className="admin-image-preview" src={editing.imageUrl} alt="Превью товара" />}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void handleImage(event.target.files[0])} />
          {uploadError && <p className="form-error">{uploadError}</p>}
          <div className="switches">
            <label><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Активен</label>
            <label><input type="checkbox" checked={editing.isAvailable} onChange={(event) => setEditing({ ...editing, isAvailable: event.target.checked })} /> В наличии</label>
            <label><input type="checkbox" checked={editing.isFeatured} onChange={(event) => setEditing({ ...editing, isFeatured: event.target.checked })} /> Хит</label>
          </div>
          <button className="button primary">{editing.id ? "Сохранить" : "Создать"}</button>
          {editing.id && <button className="button danger" type="button" onClick={async () => { if (window.confirm(`Удалить «${editing.name}»? История заказов сохранится.`)) { await save(`/api/admin/products/${editing.id}`, { method: "DELETE" }); setEditorOpen(false); setEditing(blank); } }}>Удалить товар</button>}
        </form>
        </div>
      )}
      <div className="admin-table product-admin-table">
        {!products.length && <AdminEmpty title="Товары не найдены" text="Добавьте первый товар или измените поиск." />}
        {products.map((product) => (
          <article key={product.id}>
            <img src={product.imageUrl} alt="" />
            <div><strong>{product.name}</strong><p>{money(product.price)} / {product.unit}</p></div>
            <span className={product.isAvailable ? "status-pill ok" : "status-pill stop"}>{product.isAvailable ? "В наличии" : "Стоп"}</span>
            {editable && <button onClick={() => { setEditing(product); setEditorOpen(true); }}>Редактировать</button>}
          </article>
        ))}
      </div>
    </>
  );
}

function AdminAddonRow({ addon, save }: { addon: Addon; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const [draft, setDraft] = useState(addon);
  useEffect(() => setDraft(addon), [addon.name, addon.price, addon.isActive]);
  return (
    <article>
      <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Название дополнения" />
      <input type="number" min="0" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} aria-label="Цена дополнения" />
      <label><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /> Активно</label>
      <button type="button" onClick={() => save("/api/admin/addons/" + addon.id, { method: "PUT", body: JSON.stringify(draft) })}>Сохранить</button>
      <button type="button" onClick={() => save("/api/admin/addons/" + addon.id, { method: "DELETE" })}>Удалить</button>
    </article>
  );
}

function AdminCategories({ admin, save, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; query: string }) {
  const blank: Category = { id: "", name: "", minPrice: "", sortOrder: admin.categories.length + 1, isActive: true };
  const [editing, setEditing] = useState<Category | null>(null);
  const editable = can(admin, "products.edit");
  const normalized = query.trim().toLowerCase();
  const categories = admin.categories.filter((category) => !normalized || category.name.toLowerCase().includes(normalized));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await save(editing.id ? `/api/admin/categories/${editing.id}` : "/api/admin/categories", { method: editing.id ? "PUT" : "POST", body: JSON.stringify(editing) });
    setEditing(null);
  }
  return <>
    <AdminSectionHero eyebrow="Управление меню" title="КАТЕГОРИИ" text="Создавайте, сортируйте и отключайте разделы каталога." action={editable ? <button className="button primary" onClick={() => setEditing(blank)}><Plus size={18} /> Добавить категорию</button> : undefined} />
    <div className="admin-table category-admin-table">
      {!categories.length && <AdminEmpty title="Категорий пока нет" text="Создайте категорию, чтобы организовать меню." />}
      {categories.sort((a, b) => a.sortOrder - b.sortOrder).map((category) => <article key={category.id}>
        <b className="admin-sort-index">{category.sortOrder}</b>
        <div><strong>{category.name}</strong><p>{category.minPrice || "Подпись цены не задана"}</p></div>
        <span>{admin.products.filter((product) => product.categoryId === category.id).length} товаров</span>
        <span className={category.isActive === false ? "status-pill stop" : "status-pill ok"}>{category.isActive === false ? "Отключена" : "Активна"}</span>
        {editable && <button onClick={() => setEditing(category)}>Редактировать</button>}
      </article>)}
    </div>
    {editing && <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label="Редактор категории"><button className="admin-editor-backdrop" onClick={() => setEditing(null)} aria-label="Закрыть" /><form className="admin-form admin-card-form admin-editor" onSubmit={submit}><button className="admin-editor-close" type="button" onClick={() => setEditing(null)} aria-label="Закрыть">×</button><div className="admin-section-title compact"><h3>{editing.id ? "Редактировать категорию" : "Новая категория"}</h3></div><label>Название<input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Подпись цены<input value={editing.minPrice} onChange={(event) => setEditing({ ...editing, minPrice: event.target.value })} placeholder="Например, от 320 ₽" /></label><label>Порядок<input type="number" min="0" value={editing.sortOrder} onChange={(event) => setEditing({ ...editing, sortOrder: Number(event.target.value) })} /></label><label className="admin-toggle"><input type="checkbox" checked={editing.isActive !== false} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Активна</label><button className="button primary">Сохранить</button>{editing.id && <button type="button" className="button danger" onClick={async () => { if (window.confirm(`Удалить категорию «${editing.name}»?`)) { await save(`/api/admin/categories/${editing.id}`, { method: "DELETE" }); setEditing(null); } }}>Удалить категорию</button>}</form></div>}
  </>;
}

function AdminAddons({ admin, save, uploadImage, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; uploadImage: (file: File) => Promise<string>; query: string }) {
  const blank: Addon = { id: "", name: "", price: 0, group: "Соусы", description: "", imageUrl: "", isCustomerVisible: true, sortOrder: admin.addons.length + 1, isActive: true };
  const [editing, setEditing] = useState<Addon | null>(null);
  const [uploadError, setUploadError] = useState("");
  const editable = can(admin, "products.edit");
  const normalized = query.trim().toLowerCase();
  const addons = admin.addons.filter((addon) => !normalized || `${addon.name} ${addon.group}`.toLowerCase().includes(normalized));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await save(editing.id ? `/api/admin/addons/${editing.id}` : "/api/admin/addons", { method: editing.id ? "PUT" : "POST", body: JSON.stringify(editing) });
    setEditing(null);
  }
  async function setImage(file: File) { try { setUploadError(""); const imageUrl = await uploadImage(file); setEditing((current) => current ? { ...current, imageUrl } : current); } catch (error) { setUploadError(error instanceof Error ? error.message : "Ошибка загрузки"); } }
  return <>
    <AdminSectionHero eyebrow="Управление меню" title="ДОПОЛНЕНИЯ" text="Соусы, добавки и другие опции, доступные выбранным товарам." action={editable ? <button className="button primary" onClick={() => setEditing(blank)}><Plus size={18} /> Добавить дополнение</button> : undefined} />
    <div className="admin-table addon-admin-table">{!addons.length && <AdminEmpty title="Дополнений пока нет" text="Создайте первое дополнение и назначьте его товарам." />}{addons.map((addon) => <article key={addon.id}>{addon.imageUrl ? <img src={addon.imageUrl} alt="" /> : <div className="admin-image-fallback">+</div>}<div><strong>{addon.name}</strong><p>{addon.group}</p><small>Используется в {admin.products.filter((product) => product.addonIds?.includes(addon.id)).length} товарах</small></div><b>{money(addon.price)}</b><span className={addon.isActive ? "status-pill ok" : "status-pill stop"}>{addon.isActive ? "Активно" : "Отключено"}</span>{editable && <button onClick={() => setEditing(addon)}>Редактировать</button>}</article>)}</div>
    {editing && <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label="Редактор дополнения"><button className="admin-editor-backdrop" onClick={() => setEditing(null)} aria-label="Закрыть" /><form className="admin-form admin-card-form admin-editor" onSubmit={submit}><button className="admin-editor-close" type="button" onClick={() => setEditing(null)} aria-label="Закрыть">×</button><div className="admin-section-title compact"><h3>{editing.id ? "Редактировать дополнение" : "Новое дополнение"}</h3></div>{editing.imageUrl && <img className="admin-image-preview" src={editing.imageUrl} alt="" />}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void setImage(event.target.files[0])} />{uploadError && <p className="form-error">{uploadError}</p>}<label>Название<input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><div className="two-fields"><label>Группа<input value={editing.group} onChange={(event) => setEditing({ ...editing, group: event.target.value })} /></label><label>Цена<input type="number" min="0" value={editing.price} onChange={(event) => setEditing({ ...editing, price: Number(event.target.value) })} /></label></div><label>Описание<textarea value={editing.description || ""} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label>Порядок<input type="number" min="0" value={editing.sortOrder || 0} onChange={(event) => setEditing({ ...editing, sortOrder: Number(event.target.value) })} /></label><div className="switches"><label><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Активно</label><label><input type="checkbox" checked={editing.isCustomerVisible !== false} onChange={(event) => setEditing({ ...editing, isCustomerVisible: event.target.checked })} /> Видно клиенту</label></div><button className="button primary">Сохранить</button>{editing.id && <button className="button danger" type="button" onClick={async () => { if (window.confirm(`Удалить «${editing.name}»? Связи с товарами будут сняты.`)) { await save(`/api/admin/addons/${editing.id}`, { method: "DELETE" }); setEditing(null); } }}>Удалить</button>}</form></div>}
  </>;
}

function AdminClients({ admin, query }: { admin: AdminBootstrap; query: string }) {
  const clients = useMemo(() => {
    const byPhone = new Map<string, { name: string; phone: string; orders: Order[]; total: number; lastAt: string }>();
    admin.orders.forEach((order) => {
      const key = order.phone.replace(/\D/g, "") || order.customerName.toLowerCase();
      const item = byPhone.get(key) || { name: order.customerName, phone: order.phone, orders: [], total: 0, lastAt: order.createdAt };
      item.orders.push(order); item.total += order.status === "cancelled" ? 0 : order.total; if (order.createdAt > item.lastAt) item.lastAt = order.createdAt; byPhone.set(key, item);
    });
    return [...byPhone.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [admin.orders]);
  const normalized = query.trim().toLowerCase();
  const filtered = clients.filter((client) => !normalized || `${client.name} ${client.phone}`.toLowerCase().includes(normalized));
  return <><AdminSectionHero eyebrow="История заказов" title="КЛИЕНТЫ" text="Справочник формируется автоматически из реальных заказов и не хранит лишних данных." /><div className="admin-table client-admin-table">{!filtered.length && <AdminEmpty title="Клиентов пока нет" text="Они появятся здесь после первого заказа." />}{filtered.map((client) => <article key={client.phone}><div className="admin-avatar"><span>{client.name.slice(0, 1)}</span></div><div><strong>{client.name}</strong><p><a href={`tel:${client.phone}`}>{client.phone}</a></p><small>Последний заказ: {new Date(client.lastAt).toLocaleDateString("ru-RU")}</small></div><span>{client.orders.length} заказов</span>{can(admin, "analytics.financial") && <b>{money(client.total)}</b>}</article>)}</div></>;
}

function AdminUsers({ admin, save, uploadImage, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; uploadImage: (file: File) => Promise<string>; query: string }) {
  const blankUser = { login: "", password: "", firstName: "", lastName: "", displayName: "", role: "EMPLOYEE" as UserRole, position: "Сотрудник", avatarUrl: "", phone: "", workPointId: "", shiftType: "DAY" as ShiftType, telegramLinkCode: "", isActive: true };
  const [user, setUser] = useState(blankUser);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editDraft, setEditDraft] = useState(blankUser);
  const [uploadError, setUploadError] = useState("");
  const owner = can(admin, "users.create");
  const normalized = query.trim().toLowerCase();
  const users = admin.users.filter((item) => !normalized || `${userName(item)} ${item.phone} ${item.position} ${roleLabel(item.role)}`.toLowerCase().includes(normalized));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner) return;
    await save("/api/admin/users", { method: "POST", body: JSON.stringify(user) });
    setUser(blankUser);
    setCreating(false);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!owner || !editing) return;
    await save(`/api/admin/users/${editing.id}`, { method: "PUT", body: JSON.stringify(editDraft) });
    setEditing(null);
  }

  function startEdit(item: AdminUser) {
    setUploadError("");
    setEditing(item);
    setEditDraft({
      login: item.login,
      password: "",
      firstName: item.firstName || "",
      lastName: item.lastName || "",
      displayName: item.displayName || "",
      role: item.role,
      position: item.position || roleLabel(item.role),
      avatarUrl: item.avatarUrl || "",
      phone: item.phone || "",
      workPointId: item.workPointId || "",
      shiftType: item.shiftType || "DAY",
      telegramLinkCode: "",
      isActive: item.isActive
    });
  }

  async function setUserImage(file: File, mode: "create" | "edit") {
    try {
      setUploadError("");
      const avatarUrl = await uploadImage(file);
      if (mode === "create") setUser((current) => ({ ...current, avatarUrl }));
      else setEditDraft((current) => ({ ...current, avatarUrl }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Ошибка загрузки");
    }
  }

  return (
    <>
      <AdminSectionHero eyebrow="Управление командой" title="СОТРУДНИКИ" text="Роли, рабочие точки и доступ сотрудников. Владелец защищён от удаления." action={owner ? <button className="button primary" type="button" onClick={() => { setUploadError(""); setCreating(true); }}>+ Добавить сотрудника</button> : undefined} />
      {owner && creating && (
        <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label="Добавить сотрудника">
          <button className="admin-editor-backdrop" type="button" aria-label="Закрыть" onClick={() => setCreating(false)} />
        <form className="admin-form admin-card-form user-create-form admin-editor" onSubmit={submit}>
          <button className="admin-editor-close" type="button" aria-label="Закрыть" onClick={() => setCreating(false)}>×</button>
          <div className="admin-section-title compact"><h3>Добавить сотрудника</h3><p>Заполните профиль и назначьте роль.</p></div>
          <div className="profile-photo-row">
            <div className="admin-avatar profile-photo">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{`${user.firstName} ${user.lastName}`.trim().slice(0, 1) || "С"}</span>}</div>
            <label className="file-field">Фото<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void setUserImage(event.target.files[0], "create")} /></label>
          </div>
          {uploadError && <p className="form-error">{uploadError}</p>}
          <div className="two-fields">
            <input value={user.firstName} onChange={(event) => setUser({ ...user, firstName: event.target.value })} placeholder="Имя" required />
            <input value={user.lastName} onChange={(event) => setUser({ ...user, lastName: event.target.value })} placeholder="Фамилия" required />
          </div>
          <div className="two-fields">
            <input value={user.login} onChange={(event) => setUser({ ...user, login: event.target.value })} placeholder="login" required />
            <input type="password" value={user.password} onChange={(event) => setUser({ ...user, password: event.target.value })} placeholder="пароль" required />
          </div>
          <div className="two-fields">
            <input value={user.position} onChange={(event) => setUser({ ...user, position: event.target.value })} placeholder="должность" />
            <input inputMode="tel" value={user.phone} onChange={(event) => setUser({ ...user, phone: formatRussianPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" />
          </div>
          <div className="two-fields">
            <select value={user.workPointId} onChange={(event) => setUser({ ...user, workPointId: event.target.value })}>
              <option value="">Точка не выбрана</option>
              {admin.pickupPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
            </select>
            <select value={user.shiftType} onChange={(event) => setUser({ ...user, shiftType: event.target.value as ShiftType })}>
              <option value="DAY">Дневная смена · 09:00–21:00</option>
              <option value="NIGHT">Ночная смена · 21:00–09:00</option>
            </select>
          </div>
<label className="admin-wide-field">Код подключения Telegram
            <input value={user.telegramLinkCode} onChange={(event) => setUser({ ...user, telegramLinkCode: event.target.value.toUpperCase() })} placeholder="Код, который прислал бот" />
          </label>
          <select value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value as UserRole })}>
            <option value="EMPLOYEE">Сотрудник</option>
            <option value="MANAGER">Управляющий</option>
            <option value="CO_OWNER">Совладелец</option>
            <option value="OWNER">Владелец</option>
          </select>
          <button className="button primary">Добавить пользователя</button>
        </form>
        </div>
      )}
      {owner && editing && (
        <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label="Редактировать сотрудника">
          <button className="admin-editor-backdrop" type="button" aria-label="Закрыть" onClick={() => setEditing(null)} />
        <form className="admin-form admin-card-form user-edit-form admin-editor" onSubmit={submitEdit}>
          <button className="admin-editor-close" type="button" aria-label="Закрыть" onClick={() => setEditing(null)}>×</button>
          <div className="admin-section-title compact"><h3>Редактировать сотрудника</h3><p>{editing.login}</p></div>
          <div className="profile-photo-row">
            <div className="admin-avatar profile-photo">{editDraft.avatarUrl ? <img src={editDraft.avatarUrl} alt="" /> : <span>{`${editDraft.firstName} ${editDraft.lastName}`.trim().slice(0, 1) || "С"}</span>}</div>
            <label className="file-field">Фото<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void setUserImage(event.target.files[0], "edit")} /></label>
          </div>
          {uploadError && <p className="form-error">{uploadError}</p>}
          <div className="two-fields">
            <input value={editDraft.firstName} onChange={(event) => setEditDraft({ ...editDraft, firstName: event.target.value })} placeholder="Имя" required />
            <input value={editDraft.lastName} onChange={(event) => setEditDraft({ ...editDraft, lastName: event.target.value })} placeholder="Фамилия" required />
          </div>
          <div className="two-fields">
            <input value={editDraft.position} onChange={(event) => setEditDraft({ ...editDraft, position: event.target.value })} placeholder="должность" />
            <input inputMode="tel" value={editDraft.phone} onChange={(event) => setEditDraft({ ...editDraft, phone: formatRussianPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" />
          </div>
          <div className="two-fields">
            <select value={editDraft.workPointId} onChange={(event) => setEditDraft({ ...editDraft, workPointId: event.target.value })}>
              <option value="">Точка не выбрана</option>
              {admin.pickupPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
            </select>
            <select value={editDraft.shiftType} onChange={(event) => setEditDraft({ ...editDraft, shiftType: event.target.value as ShiftType })}>
              <option value="DAY">Дневная смена · 09:00–21:00</option>
              <option value="NIGHT">Ночная смена · 21:00–09:00</option>
            </select>
          </div>
          <div className="two-fields">
            <select value={editDraft.role} onChange={(event) => setEditDraft({ ...editDraft, role: event.target.value as UserRole })}>
              <option value="EMPLOYEE">Сотрудник</option>
              <option value="MANAGER">Управляющий</option>
              <option value="CO_OWNER">Совладелец</option>
              <option value="OWNER">Владелец</option>
            </select>
            <input type="password" value={editDraft.password} onChange={(event) => setEditDraft({ ...editDraft, password: event.target.value })} placeholder="новый пароль, если нужно" />
          </div>
<label className="admin-wide-field">Код подключения Telegram
            <input value={editDraft.telegramLinkCode} onChange={(event) => setEditDraft({ ...editDraft, telegramLinkCode: event.target.value.toUpperCase() })} placeholder={editing.telegramChatId ? "Telegram уже подключён" : "Код, который прислал бот"} />
          </label>
          <div className="switches">
            <label>
              <input type="checkbox" checked={editing.role === "OWNER" ? true : editDraft.isActive} disabled={editing.role === "OWNER"} onChange={(event) => setEditDraft({ ...editDraft, isActive: event.target.checked })} />
              {editing.role === "OWNER" ? "Владелец всегда активен" : "Активен"}
            </label>
          </div>
          <button className="button primary">Сохранить сотрудника</button>
<button type="button" className="button ghost" onClick={() => setEditing(null)}>Отмена</button>
          {editing.id !== admin.currentUser.id && editing.role !== "OWNER" && (
            <button type="button" className="button danger" onClick={async () => { await save("/api/admin/users/" + editing.id, { method: "DELETE" }); setEditing(null); }}>Удалить сотрудника</button>
          )}
        </form>
        </div>
      )}
      <div className="user-grid">
        {!users.length && <AdminEmpty title="Сотрудники не найдены" text="Измените поисковый запрос." />}
        {users.map((item) => (
          <article key={item.id} className="user-card">
            <div className="admin-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{userName(item).slice(0, 1)}</span>}</div>
            <div>
              <strong>{userName(item)}</strong>
              <p>{roleLabel(item.role)} · {item.phone || "Телефон не указан"}</p>
              <small>{item.position || roleLabel(item.role)}{pointName(admin, item.workPointId) ? ` · ${pointName(admin, item.workPointId)}` : ""}</small>
              <small>{shiftLabel(item.shiftType || "DAY")} · Telegram: {item.telegramChatId ? "подключён" : "не подключён"}</small>
            </div>
            {owner && <button onClick={() => startEdit(item)}>Редактировать</button>}
          </article>
        ))}
      </div>
    </>
  );
}
function AdminPickup({ admin, save, uploadImage, query }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void>; uploadImage: (file: File) => Promise<string>; query: string }) {
  const blank: PickupPoint = { id: "", name: "", address: "", comment: "", description: "", imageUrl: "", services: [], sortOrder: admin.pickupPoints.length + 1, phone: "", hours: admin.settings.workHours, mapUrl: "", isActive: true };
  const [point, setPoint] = useState<PickupPoint | null>(null);
  const [uploadError, setUploadError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!point) return;
    await save(point.id ? `/api/admin/pickup-points/${point.id}` : "/api/admin/pickup-points", { method: point.id ? "PUT" : "POST", body: JSON.stringify(point) });
    setPoint(null);
  }
  const normalized = query.trim().toLowerCase();
  const points = admin.pickupPoints.filter((item) => !normalized || `${item.name} ${item.address} ${item.comment || ""}`.toLowerCase().includes(normalized));
  async function setImage(file: File) { try { setUploadError(""); const imageUrl = await uploadImage(file); setPoint((current) => current ? { ...current, imageUrl } : current); } catch (error) { setUploadError(error instanceof Error ? error.message : "Ошибка загрузки"); } }
  return (
    <>
      <AdminSectionHero eyebrow="Управление точками" title="КИОСКИ" text="Активные точки сразу доступны клиентам для самовывоза." action={can(admin, "settings.manage") ? <button className="button primary" onClick={() => setPoint(blank)}><Plus size={18} /> Добавить киоск</button> : undefined} />
      <div className="admin-table pickup-admin-table">
        {!points.length && <AdminEmpty title="Киоски не добавлены" text="Добавьте точку самовывоза." />}
        {points.map((item) => (
          <article key={item.id}>
            {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="admin-image-fallback"><Store /></div>}
            <div>
              <strong>{item.name}</strong>
              <p>{item.address || "Адрес не указан"}</p>
              {item.comment && <small>{item.comment}</small>}
              {!!item.services?.length && <small>{item.services.join(" · ")}</small>}
            </div>
            <span>{item.hours}</span>
            <span className={item.isActive ? "status-pill ok" : "status-pill stop"}>{item.isActive ? "Активен" : "Отключён"}</span>
            {can(admin, "settings.manage") && <button onClick={() => setPoint(item)}>Редактировать</button>}
          </article>
        ))}
      </div>
      {point && <div className="admin-editor-shell" role="dialog" aria-modal="true" aria-label="Редактор киоска"><button className="admin-editor-backdrop" onClick={() => setPoint(null)} aria-label="Закрыть" /><form className="admin-form admin-card-form admin-editor" onSubmit={submit}><button className="admin-editor-close" type="button" onClick={() => setPoint(null)} aria-label="Закрыть">×</button><div className="admin-section-title compact"><h3>{point.id ? "Редактировать киоск" : "Новый киоск"}</h3></div>{point.imageUrl && <img className="admin-image-preview" src={point.imageUrl} alt="" />}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void setImage(event.target.files[0])} />{uploadError && <p className="form-error">{uploadError}</p>}<label>Название<input required value={point.name} onChange={(event) => setPoint({ ...point, name: event.target.value })} /></label><label>Адрес<input value={point.address} onChange={(event) => setPoint({ ...point, address: event.target.value })} /></label><label>Ориентир<input value={point.comment || ""} onChange={(event) => setPoint({ ...point, comment: event.target.value })} /></label><label>Описание<textarea value={point.description || ""} onChange={(event) => setPoint({ ...point, description: event.target.value })} /></label><div className="two-fields"><label>Телефон<input inputMode="tel" value={point.phone} onChange={(event) => setPoint({ ...point, phone: formatRussianPhone(event.target.value) })} /></label><label>График<input value={point.hours} onChange={(event) => setPoint({ ...point, hours: event.target.value })} /></label></div><label>Сервисы<input value={(point.services || []).join(", ")} onChange={(event) => setPoint({ ...point, services: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Самовывоз 24/7, Яндекс Еда" /></label><label>Ссылка на карту<input value={point.mapUrl} onChange={(event) => setPoint({ ...point, mapUrl: event.target.value })} /></label><label>Порядок<input type="number" min="0" value={point.sortOrder || 0} onChange={(event) => setPoint({ ...point, sortOrder: Number(event.target.value) })} /></label><label className="admin-toggle"><input type="checkbox" checked={point.isActive} onChange={(event) => setPoint({ ...point, isActive: event.target.checked })} /> Активен и доступен для самовывоза</label><button className="button primary">Сохранить</button>{point.id && <button type="button" className="button danger" onClick={async () => { if (window.confirm(`Удалить киоск «${point.name}»?`)) { await save(`/api/admin/pickup-points/${point.id}`, { method: "DELETE" }); setPoint(null); } }}>Удалить киоск</button>}</form></div>}
    </>
  );
}
function AdminSettings({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const [settings, setSettings] = useState(admin.settings);
  const editable = can(admin, "settings.manage");
  return (
    <>
      <div className="admin-section-title"><h2>Настройки</h2><p>Контакты, доставка, ссылки агрегаторов и Telegram-данные хранятся на сервере.</p></div>
      <form className="admin-form admin-card-form" onSubmit={(event) => { event.preventDefault(); if (editable) void save("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }); }}>
        {(["phone", "telegramBrand", "telegramOrders", "workHours", "yandexFoodUrl", "deliveryUrl", "socialUrl"] as const).map((key) => <input key={key} disabled={!editable} inputMode={key === "phone" ? "tel" : undefined} value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: key === "phone" ? formatRussianPhone(event.target.value) : event.target.value })} placeholder={key === "phone" ? "+7 (___) ___-__-__" : key} />)}
        <textarea disabled={!editable} value={settings.deliveryRegions} onChange={(event) => setSettings({ ...settings, deliveryRegions: event.target.value })} placeholder="Районы" />
        <div className="two-fields">
          <input disabled={!editable} type="number" value={settings.deliveryPrice} onChange={(event) => setSettings({ ...settings, deliveryPrice: Number(event.target.value) })} placeholder="Стоимость доставки" />
          <input disabled={!editable} type="number" value={settings.freeDeliveryFrom} onChange={(event) => setSettings({ ...settings, freeDeliveryFrom: Number(event.target.value) })} placeholder="Бесплатно от" />
        </div>
        {editable && <button className="button primary">Сохранить настройки</button>}
      </form>
    </>
  );
}
function AdminSectionHero({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <header className="admin-section-hero"><div><p className="admin-eyebrow">{eyebrow}</p><h2>{title}</h2><p>{text}</p></div>{action && <div className="admin-section-action">{action}</div>}</header>;
}

function AdminEmpty({ title, text }: { title: string; text: string }) {
  return <div className="admin-empty"><Package size={30} /><strong>{title}</strong><p>{text}</p></div>;
}
function SectionHead({ title, text }: { title: string; text: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function EmptyProducts() {
  return (
    <div className="placeholder-panel">
      <h2>Пока здесь пусто.</h2>
      <p>Товары можно добавить или включить через админ-панель.</p>
    </div>
  );
}

function SystemState({ title, text, actionLabel, onAction }: { title: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <main className="system-state">
      <h1>{title}</h1>
      <p>{text}</p>
      {onAction ? <button className="button primary" type="button" onClick={onAction}>{actionLabel || "Повторить"}</button> : <Link className="button primary" to="/">На главную</Link>}
    </main>
  );
}

export default App;




