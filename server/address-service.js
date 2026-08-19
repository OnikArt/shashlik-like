const housePattern = /(?:^|[,\s])(?:д(?:ом)?\.?\s*)?(\d+[а-яa-z]?(?:[/-]\d+[а-яa-z]?)?)(?:\s|,|$)/iu;
const explicitCityPattern = /(?:^|,|\s)г(?:ород)?\.?\s*([^,]+)(?:,|$)/iu;

export class AddressValidationError extends Error {
  constructor(message, code = "invalid_address") {
    super(message);
    this.code = code;
    this.httpStatus = 400;
  }
}

export function normalizeAddress(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .slice(0, 240);
}

export function validateDeliveryAddress(value) {
  const input = normalizeAddress(value);
  if (input.length < 6) {
    throw new AddressValidationError("Укажите улицу и номер дома", "address_too_short");
  }

  const cityMatch = input.match(explicitCityPattern);
  if (cityMatch && !cityMatch[1].toLocaleLowerCase("ru-RU").includes("воронеж")) {
    throw new AddressValidationError("Сейчас доставка работает только по Воронежу", "outside_delivery_city");
  }

  const houseMatch = input.match(housePattern);
  if (!houseMatch) {
    throw new AddressValidationError("Добавьте номер дома и выберите точный адрес", "house_required");
  }

  const house = houseMatch[1];
  const street = input
    .replace(explicitCityPattern, " ")
    .replace(houseMatch[0], " ")
    .replace(/\b(?:Россия|Воронежская область|Воронеж)\b/giu, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s+/g, " ");

  if (street.length < 3) {
    throw new AddressValidationError("Укажите название улицы", "street_required");
  }

  return {
    formattedAddress: `Воронеж, ${street}, ${house}`,
    city: "Воронеж",
    street,
    house,
    latitude: null,
    longitude: null,
    provider: "local",
    precision: "house",
    deliveryZone: "configured-regions",
    deliverable: true
  };
}

