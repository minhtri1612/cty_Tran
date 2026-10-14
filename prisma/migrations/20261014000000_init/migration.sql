-- CreateTable
CREATE TABLE "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "password_salt" BLOB NOT NULL,
    "password_hash" BLOB NOT NULL,
    "created_at" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin'
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL,
    CONSTRAINT "sessions_username_fkey" FOREIGN KEY ("username") REFERENCES "users" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "materials" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "minimum" REAL NOT NULL DEFAULT 0,
    "price" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "material_profiles" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "profile_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL,
    "total" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer" TEXT NOT NULL,
    "signed_date" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "issue_count" TEXT NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "suppliers" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "supplier_categories" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "profile_json" TEXT NOT NULL,
    CONSTRAINT "supplier_profiles_name_fkey" FOREIGN KEY ("name") REFERENCES "suppliers" ("name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "supplier" TEXT NOT NULL PRIMARY KEY,
    "products_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "document_details" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "detail_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "order_details" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "detail_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "ledger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "material_code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "reference" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "lines_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "app_meta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "sessions_expiry" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "ledger_material_date" ON "ledger"("material_code", "date");


-- Seed state version (the state save updates this row atomically)
INSERT INTO "app_meta" ("key", "value") VALUES ('version', '0');
