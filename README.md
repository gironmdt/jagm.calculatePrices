# API Next.js - Cálculo de Precios

API Next.js para extraer y procesar precios de productos desde boletines PDF de Corabastos.

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

El servidor se iniciará en [http://localhost:3000](http://localhost:3000)

## Endpoints

### API

- `GET /api/hello` - Endpoint dummy de ejemplo
- `GET /api/prices` - Extrae precios de productos desde el boletín diario de Corabastos

### Páginas

- `/` - Página principal con enlaces

## Endpoint de Precios

El endpoint `/api/prices` descarga y parsea el PDF del boletín diario de Corabastos para extraer los precios de los productos.

**Ejemplo de respuesta:**

```json
{
  "fecha": "2025-11-21",
  "totalProductos": 150,
  "productos": [
    {
      "producto": "Aguacate Hass",
      "precio": "$8000",
      "unidad": "kg"
    },
    {
      "producto": "Tomate",
      "precio": "$3000",
      "unidad": "kg"
    }
  ],
  "fuente": "https://corabastos.com.co/wp-content/uploads/2025/11/Boletin_diario_20251121.pdf"
}
```

## Estructura del Proyecto

```
.
├── app/
│   ├── api/
│   │   ├── hello/
│   │   │   └── route.ts      # Endpoint dummy
│   │   └── prices/
│   │       └── route.ts      # Endpoint de precios
│   ├── layout.tsx
│   └── page.tsx
├── next.config.js
├── tsconfig.json
└── package.json
```

## Dependencias

- **next**: Framework React
- **pdf-parse**: Librería para parsear archivos PDF

