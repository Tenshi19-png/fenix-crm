-- ============================================================================
-- FENIX CRM - ESQUEMA POSTGRESQL / SUPABASE (LISTO PARA PRODUCCIÓN EN NUBE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
  slug TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  hoja TEXT NOT NULL UNIQUE,
  operador_form TEXT NOT NULL,
  iniciales_pagos TEXT NOT NULL DEFAULT '',
  tipo_categoria TEXT NOT NULL DEFAULT 'fibra',
  basada_en TEXT DEFAULT '',
  es_movil_espejo BOOLEAN NOT NULL DEFAULT FALSE,
  ocultar_en_espejo_movil BOOLEAN NOT NULL DEFAULT FALSE,
  usa_portado BOOLEAN NOT NULL DEFAULT FALSE,
  emoji TEXT NOT NULL DEFAULT '📊',
  color TEXT NOT NULL DEFAULT '#1a73e8',
  orden INTEGER NOT NULL DEFAULT 100,
  columnas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisors (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '',
  token_acceso TEXT NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS executive_goals (
  ejecutiva_norm TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  minimo_ventas INTEGER NOT NULL DEFAULT 10,
  supervisor_habitual TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payment_settings (
  clave TEXT PRIMARY KEY,
  valor NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_slug TEXT NOT NULL REFERENCES companies(slug) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  fecha_orden INTEGER NOT NULL DEFAULT 0,
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  ejecutivo TEXT NOT NULL DEFAULT '',
  supervisor TEXT NOT NULL DEFAULT '',
  comuna TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT '',
  direccion_limpia TEXT NOT NULL DEFAULT '',
  rut TEXT NOT NULL DEFAULT '',
  nombre_cliente TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  numero_principal TEXT NOT NULL DEFAULT '',
  adicional TEXT NOT NULL DEFAULT '',
  cant_titular INTEGER NOT NULL DEFAULT 0,
  cant_adicional INTEGER NOT NULL DEFAULT 0,
  correo TEXT NOT NULL DEFAULT '',
  servicio TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  id_orden TEXT NOT NULL DEFAULT '',
  fecha_instalacion TEXT NOT NULL DEFAULT '',
  observacion TEXT NOT NULL DEFAULT '',
  subcompania TEXT NOT NULL DEFAULT '',
  hizo_click TEXT NOT NULL DEFAULT '',
  imagen_url TEXT NOT NULL DEFAULT '',
  ficha_original TEXT NOT NULL DEFAULT '',
  notas_movil TEXT NOT NULL DEFAULT '',
  seguimiento_movil TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_company_orden ON sales(company_slug, fecha_orden DESC);
CREATE INDEX IF NOT EXISTS idx_sales_supervisor ON sales(supervisor);
CREATE INDEX IF NOT EXISTS idx_sales_rut ON sales(rut);
CREATE INDEX IF NOT EXISTS idx_sales_mes_anio ON sales(anio, mes);

