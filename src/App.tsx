import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Bike, ChevronDown, ChevronLeft, ChevronRight, Clock3, Flame, Grid2X2, Heart, Leaf, List, MapPin, Menu as MenuIcon, MessageCircle, Phone, Plus, Search, Send, ShoppingBag, SlidersHorizontal, Store, Target, X } from "lucide-react";
import { apiFetch, apiUrl } from "./api";

type Category = { id: string; name: string; minPrice: string; sortOrder: number };
type Addon = { id: string; name: string; price: number; isActive: boolean; group: string };
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
type PickupPoint = { id: string; name: string; address: string; phone: string; hours: string; mapUrl: string; comment?: string; isActive: boolean };
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
type AdminBootstrap = Bootstrap & { orders: Order[]; orderStatuses: OrderStatus[]; orderStatusLabels: Record<OrderStatus, string>; users: AdminUser[]; currentUser: AdminUser; permissions: string[]; analyticsSummary: AnalyticsSummary | null };
type Attribution = { utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string; referrer: string; landing_page: string };

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  deliveryType: "delivery" | "pickup";
  address: string;
  comment: string;
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
  items: Array<{ name: string; quantity: number; quantityLabel?: string; option?: string; addons: Array<{ name: string }>; total: number }>;
  subtotal: number;
  deliveryPrice: number;
  total: number;
  pickupPointName: string;
};

const orderStatusMeta: Record<OrderStatus, { label: string; icon: string }> = {
  new: { label: "Заказ создан", icon: "●" },
  accepted: { label: "Заказ принят", icon: "✓" },
  preparing: { label: "Готовится", icon: "🔥" },
  ready: { label: "Заказ готов", icon: "✓" },
  delivering: { label: "Передан курьеру", icon: "→" },
  completed: { label: "Заказ доставлен", icon: "✓" },
  cancelled: { label: "Заказ отменён", icon: "×" }
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

function useActiveOrder() {
  const [order, setOrder] = useState<TrackingOrder | null>(null);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const load = async () => {
      const token = localStorage.getItem("activeOrderTrackingToken") || "";
      if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) {
        if (active) setOrder(null);
        return;
      }
      try {
        const response = await apiFetch(`/api/orders/track/${encodeURIComponent(token)}`, { cache: "no-store" });
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
  }, []);

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
  const isHome = location.pathname === "/";
  const usesHomeDesign = isHome || location.pathname === "/menu" || location.pathname === "/delivery" || location.pathname === "/pickup";
  const activeOrder = useActiveOrder();

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
      {!isAdmin && activeOrder && <ActiveOrderIndicator order={activeOrder} />}
      <div className="delivery-content">
        <Routes>
          <Route path="/" element={<Home data={data} onAdd={addToCart} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} />} />
          <Route path="/menu" element={<Menu data={data} onAdd={addToCart} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} />} />
          <Route path="/delivery" element={<Delivery data={data} cartCount={cart.count} cartTotal={cart.subtotal} onCartOpen={() => { trackEvent("cart_opened", { value: cart.subtotal }); setDrawerOpen(true); }} />} />
          <Route path="/pickup" element={<Navigate to="/delivery#kiosks" replace />} />
          <Route path="/about" element={<About />} />
          <Route path="/contacts" element={<Contacts settings={data.settings} />} />
          <Route path="/cart" element={<CartPage data={data} cart={cart} />} />
          <Route path="/checkout" element={<Checkout data={data} cart={cart} />} />
          <Route path="/order-success" element={<Success settings={data.settings} />} />
          <Route path="/order/:trackingToken" element={<OrderTracking />} />
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

function ActiveOrderIndicator({ order }: { order: TrackingOrder }) {
  const token = localStorage.getItem("activeOrderTrackingToken") || "";
  const status = order.status === "preparing" ? orderStatusMeta.accepted : orderStatusMeta[order.status];
  return (
    <Link className="active-order-indicator" to={`/order/${encodeURIComponent(token)}`} aria-label={`Открыть статус заказа ${order.orderNumber}: ${status.label}`}>
      <span className="active-order-pulse" aria-hidden="true" />
      <span><small>Ваш заказ {order.orderNumber}</small><strong>{status.label}</strong></span>
      <b>Статус →</b>
    </Link>
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
        <img src="/assets/logo.png" alt="" aria-hidden="true" width="52" height="52" decoding="async" />
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
};

const homePrimaryPhone = "+7 (909) 211-82-11";
const phoneHref = (value: string) => `tel:${value.replace(/[^+\d]/g, "")}`;

function Home({ data, onAdd, cartCount, cartTotal, onCartOpen }: HomeProps) {
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
      <HomeHeader settings={data.settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} />
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
              {[homePrimaryPhone, data.settings.phone].map((phone) => <a key={phone} href={phoneHref(phone)}><Phone /><strong>{phone}</strong></a>)}
              <a href={`https://t.me/${data.settings.telegramBrand.replace("@", "")}`} target="_blank" rel="noreferrer"><Send /><strong>{data.settings.telegramBrand}</strong></a>
              <a href={`https://t.me/${data.settings.telegramOrders.replace("@", "")}`} target="_blank" rel="noreferrer"><MessageCircle /><strong>{data.settings.telegramOrders}</strong></a>
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

function HomeHeader({ settings, cartCount, cartTotal, onCartOpen, activePath }: { settings: Settings; cartCount: number; cartTotal: number; onCartOpen: () => void; activePath?: string }) {
  const [open, setOpen] = useState(false);
  const navigation = [["Меню", "/menu"], ["Акции", "#promotions"], ["Доставка", "/delivery"], ["О нас", "/about"], ["Контакты", "/contacts"]];
  return (
    <header className="home-header">
      <div className="home-header-inner home-container">
        <Link className="home-brand" to="/" aria-label="Шашлык Лайк и ШашлычОК, главная"><span className="home-brand-mark"><Flame /></span><span><strong>ШАШЛЫК <i>ЛАЙК</i> <b>×</b> ШАШЛЫЧ<i>ОК</i></strong><small>Воронеж · настоящий вкус на углях</small></span></Link>
        <nav className={open ? "home-nav open" : "home-nav"} aria-label="Навигация по сайту">
          {navigation.map(([label, href]) => href.startsWith("#") ? <a key={href} href={activePath ? `/${href}` : href} onClick={() => setOpen(false)}>{label}</a> : <Link className={activePath === href ? "active" : ""} key={href} to={href} onClick={() => setOpen(false)}>{label}</Link>)}
          <div className="home-nav-mobile-phones"><a href={phoneHref(homePrimaryPhone)}>{homePrimaryPhone}</a><a href={phoneHref(settings.phone)}>{settings.phone}</a></div>
        </nav>
        <div className="home-header-actions">
          <a className="home-phone" href={phoneHref(homePrimaryPhone)}><Phone /> <span>{homePrimaryPhone}</span></a>
          <a className="home-phone secondary" href={phoneHref(settings.phone)}><Phone /> <span>{settings.phone}</span></a>
          <button className="home-cart-button" onClick={onCartOpen} aria-label={`Открыть корзину, товаров ${cartCount}`}><ShoppingBag />{cartCount > 0 && <b>{cartCount}</b>}<span>{cartTotal > 0 ? money(cartTotal) : "Корзина"}</span></button>
          <button className="home-menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Закрыть меню" : "Открыть меню"}>{open ? <X /> : <MenuIcon />}</button>
        </div>
      </div>
    </header>
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
  return (
    <footer className="home-footer"><div className="home-container"><div><Link className="home-brand" to="/"><span className="home-brand-mark"><Flame /></span><span><strong>ШАШЛЫК <i>ЛАЙК</i> × ШАШЛЫЧ<i>ОК</i></strong><small>Воронеж · настоящий вкус на углях</small></span></Link><p>Две сети — одна любовь к настоящему вкусу.</p></div><nav><strong>Навигация</strong><Link to="/menu">Меню</Link><Link to="/#promotions">Акции</Link><Link to="/delivery">Доставка</Link><Link to="/about">О нас</Link><Link to="/contacts">Контакты</Link></nav><div><strong>Контакты</strong><a href={phoneHref(homePrimaryPhone)}>{homePrimaryPhone}</a><a href={phoneHref(settings.phone)}>{settings.phone}</a><span>Ежедневно {settings.workHours}</span></div><div><strong>Мы в Telegram</strong><a href={`https://t.me/${settings.telegramBrand.replace("@", "")}`}>{settings.telegramBrand}</a><a href={`https://t.me/${settings.telegramOrders.replace("@", "")}`}>{settings.telegramOrders}</a></div></div><div className="home-footer-bottom home-container"><span>© {new Date().getFullYear()} Шашлык Лайк × ШашлычОК. Все права защищены.</span><span>Воронеж</span></div></footer>
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
};

type MenuSort = "default" | "price-asc" | "price-desc" | "name";
type MenuView = "grid" | "list";

function Menu({ data, onAdd, cartCount, cartTotal, onCartOpen }: MenuProps) {
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
      <HomeHeader settings={data.settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/menu" />

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
        <img src={product.imageUrl || "/assets/placeholder.svg"} alt={product.name} loading="lazy" decoding="async" width="800" height="600" />
        {product.badge && <span>{product.badge}</span>}
        <button type="button" className={`menu-favorite${favorite ? " active" : ""}`} aria-pressed={favorite} onClick={() => onFavorite(product.id)} aria-label={`${favorite ? "Убрать" : "Добавить"} ${product.name} ${favorite ? "из" : "в"} избранное`}><Heart fill={favorite ? "currentColor" : "none"} /></button>
      </div>
      <div className="product-body">
        <div><h3 className="product-title" title={product.name}>{product.name}</h3><p className="product-description" title={product.description}>{product.description}</p></div>
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
            <strong>ОПЛАТА ПРИ ПОЛУЧЕНИИ</strong>
            <p>Мы передадим ваш заказ в обработку и свяжемся с вами для подтверждения. Оплата производится при получении заказа.</p>
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

function OrderTracking() {
  const { trackingToken = "" } = useParams();
  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "network-error" | "reconnecting">("loading");
  const completedTracked = useRef(false);

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(trackingToken)) {
      setState("not-found");
      return;
    }
    let active = true;
    let timer = 0;
    trackEvent("order_tracking_opened");
    const load = async (initial = false) => {
      try {
        const response = await apiFetch(`/api/orders/track/${encodeURIComponent(trackingToken)}`, { cache: "no-store" });
        if (response.status === 404) {
          if (active) setState("not-found");
          return;
        }
        if (!response.ok) throw new Error("network");
        const payload = await response.json() as { order: TrackingOrder };
        if (active) {
          setOrder(payload.order);
          setState("ready");
          if (["completed", "cancelled"].includes(payload.order.status)) clearActiveOrderToken(trackingToken);
          if (payload.order.status === "completed" && !completedTracked.current) {
            completedTracked.current = true;
            trackEvent("order_completed", { value: payload.order.total });
          }
        }
      } catch {
        if (active) setState(initial && !order ? "network-error" : "reconnecting");
      }
    };
    void load(true);
    timer = window.setInterval(() => void load(false), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [trackingToken]);

  if (state === "loading") return <SystemState title="ЗАГРУЖАЕМ ЗАКАЗ" text="Получаем актуальный статус с сервера." />;
  if (state === "not-found") return <SystemState title="ЗАКАЗ НЕ НАЙДЕН" text="Ссылка недействительна или заказ больше недоступен." />;
  if (state === "network-error" && !order) return <SystemState title="НЕТ СВЯЗИ" text="Не удалось загрузить заказ. Проверьте интернет и обновите страницу." />;
  if (!order) return null;

  const stages: Array<{ status: OrderStatus; label: string; timestamp: keyof TrackingOrder }> = [
    { status: "new", label: "Заказ создан", timestamp: "createdAt" },
    { status: "accepted", label: "Заказ принят", timestamp: "acceptedAt" },
    { status: "ready", label: "Готов", timestamp: "readyAt" },
    ...(order.fulfillmentType === "delivery" ? [{ status: "delivering" as OrderStatus, label: "Передан курьеру", timestamp: "deliveringAt" as keyof TrackingOrder }] : []),
    { status: "completed", label: order.fulfillmentType === "pickup" ? "Заказ выдан" : "Доставлен", timestamp: "completedAt" }
  ];
  const publicStatus = order.status === "preparing" ? "accepted" : order.status;
  const currentIndex = stages.findIndex((stage) => stage.status === publicStatus);
  const expected = ({
    new: "Ожидаем подтверждения",
    accepted: "Около 30–50 минут",
    preparing: "Около 20–40 минут",
    ready: order.fulfillmentType === "pickup" ? "Можно забирать" : "Скоро передадим курьеру",
    delivering: "Около 10–25 минут",
    completed: "Заказ уже у вас",
    cancelled: "Заказ остановлен"
  } as Record<OrderStatus, string>)[order.status];
  const currentMeta = order.status === "preparing" ? orderStatusMeta.accepted : orderStatusMeta[order.status];
  const publicLabel = order.status === "completed" && order.fulfillmentType === "pickup" ? "Заказ выдан" : currentMeta.label;

  return (
    <section className={`tracking-page status-${order.status}`}>
      <div className="tracking-head">
        <div>
          <p className="eyebrow">ЗАКАЗ #{order.orderNumber}</p>
          <h1><span>{currentMeta.icon}</span> {publicLabel}</h1>
          <p>{order.status === "completed" ? "Спасибо за заказ!" : order.status === "cancelled" ? "Заказ отменён. Для уточнения свяжитесь с нами." : "Статус обновляется автоматически."}</p>
        </div>
        <div className="tracking-eta"><small>Ожидаемое время</small><strong>{expected}</strong></div>
      </div>
      {state === "reconnecting" && <div className="tracking-reconnect" role="status">Связь восстанавливается. На экране показан последний подтверждённый статус.</div>}
      {order.status !== "cancelled" && (
        <ol className="order-timeline">
          {stages.map((stage, index) => {
            const complete = Boolean(order[stage.timestamp]) || (currentIndex >= 0 && index < currentIndex);
            const current = stage.status === publicStatus;
            return <li key={stage.status} className={current ? "current" : complete ? "complete" : "pending"}><i>{complete || current ? "✓" : ""}</i><span>{stage.label}</span></li>;
          })}
        </ol>
      )}
      <div className="tracking-grid">
        <article className="tracking-items">
          <h2>Ваш заказ</h2>
          {order.items.map((item, index) => (
            <div className="tracking-item" key={`${item.name}-${index}`}>
              <div><strong>{item.name}</strong><small>{[item.quantityLabel || item.quantity, item.option, item.addons.map((addon) => addon.name).join(", ")].filter(Boolean).join(" · ")}</small></div>
              <strong>{money(item.total)}</strong>
            </div>
          ))}
          <div className="tracking-total"><span>Итого</span><strong>{money(order.total)}</strong></div>
        </article>
        <aside className="tracking-fulfillment">
          <small>Способ получения</small>
          <strong>{order.fulfillmentType === "pickup" ? "Самовывоз" : "Доставка"}</strong>
          {order.pickupPointName && <p>{order.pickupPointName}</p>}
        </aside>
      </div>
      {(order.status === "completed" || order.status === "cancelled") && <Link className="button primary tracking-repeat" to="/menu">ЗАКАЗАТЬ ЕЩЁ →</Link>}
    </section>
  );
}

type DeliveryProps = {
  data: Bootstrap;
  cartCount: number;
  cartTotal: number;
  onCartOpen: () => void;
};

function Delivery({ data, cartCount, cartTotal, onCartOpen }: DeliveryProps) {
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
      <HomeHeader settings={settings} cartCount={cartCount} cartTotal={cartTotal} onCartOpen={onCartOpen} activePath="/delivery" />
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

function About() {
  return (
    <section className="page editorial">
      <h1>О НАС</h1>
      <p>
        Шашлык Лайк — современный digital food brand с шашлыком, шаурмой, люля и блюдами на углях. Главный фокус сайта:
        быстро выбрать еду, понять цену и оформить заказ без лишних шагов.
      </p>
    </section>
  );
}

function Contacts({ settings }: { settings: Settings }) {
  return (
    <section className="page">
      <div className="page-head">
        <h1>КОНТАКТЫ</h1>
        <p>Для заказа и связи используем только данные из ТЗ.</p>
      </div>
      <div className="contact-grid">
        <article>
          <span>Для заказа</span>
          <strong>{settings.telegramOrders}</strong>
        </article>
        <article>
          <span>Для связи</span>
          <strong>{settings.telegramBrand}</strong>
        </article>
        <article>
          <span>Телефон</span>
          <strong>{settings.phone}</strong>
        </article>
        <article>
          <span>Время работы</span>
          <strong>{settings.workHours}</strong>
        </article>
      </div>
    </section>
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
    } catch {
      setError("Изменения не сохранены: нет связи с сервером.");
    }
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
            <img src="/assets/logo.png" alt="" />
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
    ["dashboard", "Панель", "▦"],
    ["analytics", "Аналитика", "↗"],
    ["orders", "Заказы", "✓"],
    ["products", "Товары", "□"],
    ["users", "Люди", "◌"],
    ["pickup", "Точки", "⌖"],
    ["profile", "Профиль", "◉"],
    ["settings", "Настройки", "⚙"]
  ].filter(([id]) => (id !== "settings" || can(admin, "settings.manage")) && (id !== "analytics" || can(admin, "analytics.basic")));
  const currentName = userName(admin.currentUser);

  return (
    <section className="admin admin-shell">
      <aside className="admin-nav">
        <div className="admin-nav-brand employee-brand">
          <div className="admin-avatar small">{admin.currentUser.avatarUrl ? <img src={admin.currentUser.avatarUrl} alt="" /> : <span>{currentName.slice(0, 1)}</span>}</div>
          <span>
            <strong>{currentName}</strong>
            <small>{admin.currentUser.position || roleLabel(admin.currentUser.role)}</small>
          </span>
        </div>
        <div className="admin-nav-list">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <button className="admin-logout" onClick={logout}>Выйти</button>
      </aside>
      <div className="admin-work">
        <div className="admin-topbar">
          <div>
            <p>Добро пожаловать</p>
            <h1>{currentName}</h1>
          </div>
          <div className="admin-top-actions">
            <ThemeToggle mode={themeMode} activeTheme={activeTheme} onChange={onThemeMode} />
            <div className="admin-avatar">{admin.currentUser.avatarUrl ? <img src={admin.currentUser.avatarUrl} alt="" /> : <span>{currentName.slice(0, 1)}</span>}</div>
          </div>
        </div>
        {error && <p className="form-error admin-error">{error}</p>}
        {tab === "dashboard" && <AdminDashboard admin={admin} />}
        {tab === "analytics" && <AdminAnalytics admin={admin} />}
        {tab === "orders" && <AdminOrders admin={admin} save={authorized} />}
        {tab === "products" && <AdminProducts admin={admin} save={authorized} />}
        {tab === "users" && <AdminUsers admin={admin} save={authorized} />}
        {tab === "pickup" && <AdminPickup admin={admin} save={authorized} />}
        {tab === "profile" && <AdminProfile admin={admin} save={authorized} />}
        {tab === "settings" && <AdminSettings admin={admin} save={authorized} />}
      </div>
    </section>
  );
}

function AdminProfile({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const [profile, setProfile] = useState(admin.currentUser);

  useEffect(() => setProfile(admin.currentUser), [admin.currentUser.id, admin.currentUser.updatedAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save(`/api/admin/users/${admin.currentUser.id}`, { method: "PUT", body: JSON.stringify(profile) });
  }

  return (
    <>
      <div className="admin-section-title"><h2>Профиль</h2><p>Эти данные видят сотрудники в справочнике команды.</p></div>
      <form className="admin-form admin-card-form profile-form" onSubmit={submit}>
        <div className="profile-photo-row">
          <div className="admin-avatar profile-photo">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{userName(profile).slice(0, 1)}</span>}</div>
          <label className="file-field">
            Фото профиля
            <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && readImageAsDataUrl(event.target.files[0], (avatarUrl) => setProfile({ ...profile, avatarUrl }))} />
          </label>
        </div>
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
      <div className="admin-section-title">
        <h2>Сегодня в смене</h2>
        <p>Статистика строится только по реальным заказам из базы.</p>
      </div>
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

function AdminOrders({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  return (
    <>
      <div className="admin-section-title"><h2>Заказы</h2><p>Новые заказы выделены, Telegram-статус виден в карточке.</p></div>
      <div className="admin-table order-table">
        {admin.orders.map((order) => (
          <article key={order.id} className={order.status === "new" ? "is-new" : ""}>
            <div>
              <strong>#{order.orderNumber}</strong>
              <p>{order.customerName} · {order.phone}</p>
              <p>{order.items.map((item) => `${item.name} · ${item.quantityLabel || item.quantity}`).join(", ")}</p>
              {order.telegram && <small>Telegram: {order.telegram.sent ? "отправлено" : order.telegram.reason || "не отправлено"}</small>}
            </div>
            {can(admin, "analytics.financial") && <strong>{money(order.total)}</strong>}
            <select value={order.status} disabled={!can(admin, "orders.change_status") || !order.availableTransitions.length} onChange={(event) => save(`/api/admin/orders/${order.id}`, { method: "PUT", body: JSON.stringify({ status: event.target.value, expectedStatus: order.status }) })}>
              <option value={order.status}>{orderStatusMeta[order.status].label}</option>
              {order.availableTransitions.map((status) => <option key={status} value={status}>{orderStatusMeta[status].label}</option>)}
            </select>
          </article>
        ))}
      </div>
    </>
  );
}

function AdminProducts({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const blank: Product = { id: "", slug: "", name: "", description: "", price: 0, unit: "1 шт", step: 1, categoryId: admin.categories[0]?.id || "shashlik", imageUrl: "/assets/placeholder.svg", isActive: true, isAvailable: true, isFeatured: false, options: [], addonIds: [], sortOrder: 999 };
  const [editing, setEditing] = useState<Product>(blank);
  const [newAddon, setNewAddon] = useState({ name: "", price: 50, group: "custom", isActive: true });
  const editable = can(admin, "products.edit");

async function createAddon(event: FormEvent) {
    event.preventDefault();
    if (!newAddon.name.trim()) return;
    await save("/api/admin/addons", { method: "POST", body: JSON.stringify(newAddon) });
    setNewAddon({ name: "", price: 50, group: "custom", isActive: true });
  }

  function toggleProductAddon(addonId: string) {
    setEditing((current) => ({
      ...current,
      addonIds: current.addonIds?.includes(addonId)
        ? current.addonIds.filter((id) => id !== addonId)
        : [...(current.addonIds || []), addonId]
    }));
  }

  function fileToDataUrl(file: File) {
    const reader = new FileReader();
    reader.onload = () => setEditing((current) => ({ ...current, imageUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editable) return;
    const isNew = !editing.id;
    await save(isNew ? "/api/admin/products" : `/api/admin/products/${editing.id}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(editing) });
    setEditing(blank);
  }

  return (
    <>
      <div className="admin-section-title"><h2>Товары</h2><p>Доступность и хиты сразу отражаются на витрине.</p></div>
      {editable && (
        <form className="admin-form admin-card-form" onSubmit={submit}>
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
          <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && fileToDataUrl(event.target.files[0])} />
          <div className="switches">
            <label><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Активен</label>
            <label><input type="checkbox" checked={editing.isAvailable} onChange={(event) => setEditing({ ...editing, isAvailable: event.target.checked })} /> В наличии</label>
            <label><input type="checkbox" checked={editing.isFeatured} onChange={(event) => setEditing({ ...editing, isFeatured: event.target.checked })} /> Хит</label>
          </div>
          <button className="button primary">{editing.id ? "Сохранить" : "Создать"}</button>
        </form>
      )}
{editable && (
        <form className="admin-form admin-card-form addon-create-form" onSubmit={createAddon}>
          <div className="admin-section-title compact"><h3>Дополнения</h3><p>Создайте галочку, затем назначьте её нужным товарам выше.</p></div>
          <input value={newAddon.name} onChange={(event) => setNewAddon({ ...newAddon, name: event.target.value })} placeholder="Название дополнения" required />
          <input type="number" min="0" value={newAddon.price} onChange={(event) => setNewAddon({ ...newAddon, price: Number(event.target.value) })} placeholder="Цена" />
          <button className="button primary">Добавить дополнение</button>
          <div className="admin-addon-list">
            {admin.addons.map((addon) => (
              <AdminAddonRow key={addon.id} addon={addon} save={save} />
            ))}
          </div>
        </form>
      )}
      <div className="admin-table product-admin-table">
        {admin.products.map((product) => (
          <article key={product.id}>
            <img src={product.imageUrl} alt="" />
            <div><strong>{product.name}</strong><p>{money(product.price)} / {product.unit}</p></div>
            <span className={product.isAvailable ? "status-pill ok" : "status-pill stop"}>{product.isAvailable ? "В наличии" : "Стоп"}</span>
            {editable && <button onClick={() => setEditing(product)}>Редактировать</button>}
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

function AdminUsers({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const blankUser = { login: "", password: "", firstName: "", lastName: "", displayName: "", role: "EMPLOYEE" as UserRole, position: "Сотрудник", avatarUrl: "", phone: "", workPointId: "", shiftType: "DAY" as ShiftType, telegramLinkCode: "", isActive: true };
  const [user, setUser] = useState(blankUser);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editDraft, setEditDraft] = useState(blankUser);
  const owner = can(admin, "users.create");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner) return;
    await save("/api/admin/users", { method: "POST", body: JSON.stringify(user) });
    setUser(blankUser);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!owner || !editing) return;
    await save(`/api/admin/users/${editing.id}`, { method: "PUT", body: JSON.stringify(editDraft) });
    setEditing(null);
  }

  function startEdit(item: AdminUser) {
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

  return (
    <>
      <div className="admin-section-title"><h2>Люди</h2><p>Справочник команды виден всем сотрудникам. Редактирование доступно владельцу.</p></div>
      {owner && (
        <form className="admin-form admin-card-form user-create-form" onSubmit={submit}>
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
      )}
      {owner && editing && (
        <form className="admin-form admin-card-form user-edit-form" onSubmit={submitEdit}>
          <div className="admin-section-title compact"><h3>Редактировать сотрудника</h3><p>{editing.login}</p></div>
          <div className="profile-photo-row">
            <div className="admin-avatar profile-photo">{editDraft.avatarUrl ? <img src={editDraft.avatarUrl} alt="" /> : <span>{`${editDraft.firstName} ${editDraft.lastName}`.trim().slice(0, 1) || "С"}</span>}</div>
            <label className="file-field">Фото<input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && readImageAsDataUrl(event.target.files[0], (avatarUrl) => setEditDraft({ ...editDraft, avatarUrl }))} /></label>
          </div>
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
      )}
      <div className="user-grid">
        {admin.users.map((item) => (
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
function AdminPickup({ admin, save }: { admin: AdminBootstrap; save: (url: string, init?: RequestInit) => Promise<void> }) {
  const [point, setPoint] = useState({ name: "", address: "", comment: "", phone: "", hours: admin.settings.workHours, mapUrl: "", isActive: true });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save("/api/admin/pickup-points", { method: "POST", body: JSON.stringify(point) });
    setPoint({ name: "", address: "", comment: "", phone: "", hours: admin.settings.workHours, mapUrl: "", isActive: true });
  }
  return (
    <>
      <div className="admin-section-title"><h2>Точки самовывоза</h2><p>Комментарий к адресу необязательный: подъезд, ориентир, вход со двора.</p></div>
      {can(admin, "settings.manage") && (
        <form className="admin-form admin-card-form" onSubmit={submit}>
          <input value={point.name} onChange={(event) => setPoint({ ...point, name: event.target.value })} placeholder="Название" required />
          <input value={point.address} onChange={(event) => setPoint({ ...point, address: event.target.value })} placeholder="Адрес" />
          <input value={point.comment} onChange={(event) => setPoint({ ...point, comment: event.target.value })} placeholder="Комментарий к адресу" />
          <input inputMode="tel" value={point.phone} onChange={(event) => setPoint({ ...point, phone: formatRussianPhone(event.target.value) })} placeholder="+7 (___) ___-__-__" />
          <input value={point.hours} onChange={(event) => setPoint({ ...point, hours: event.target.value })} placeholder="Часы работы" />
          <input value={point.mapUrl} onChange={(event) => setPoint({ ...point, mapUrl: event.target.value })} placeholder="Ссылка на карту" />
          <button className="button primary">Добавить точку</button>
        </form>
      )}
      <div className="admin-table pickup-admin-table">
        {admin.pickupPoints.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <p>{item.address || "Адрес не указан"}</p>
              {item.comment && <small>{item.comment}</small>}
            </div>
            <span>{item.hours}</span>
          </article>
        ))}
      </div>
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































