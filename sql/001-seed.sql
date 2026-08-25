-- Demo schema so `docker compose up` has something to observe.
-- Deliberately imperfect: refunds are not declared as a foreign key, and
-- amounts carry three currencies with no conversion column, so the harness has
-- real ambiguity to resolve rather than a textbook schema to transcribe.

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id    serial PRIMARY KEY,
  sku   text NOT NULL UNIQUE,
  name  text NOT NULL,
  price numeric(10,2) NOT NULL
);

CREATE TABLE orders (
  id           serial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers(id),
  status       text NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  currency     text NOT NULL,
  placed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id   integer NOT NULL REFERENCES orders(id),
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payments (
  id        serial PRIMARY KEY,
  order_id  integer NOT NULL REFERENCES orders(id),
  amount    numeric(10,2) NOT NULL,
  method    text NOT NULL,
  paid_at   timestamptz NOT NULL DEFAULT now()
);

-- No foreign key on purpose: the harness must measure the overlap to decide.
CREATE TABLE refunds (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL,
  amount     numeric(10,2) NOT NULL,
  reason     text,
  refunded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO customers (email) VALUES
  ('ada@example.com'), ('grace@example.com'), ('alan@example.com');

INSERT INTO products (sku, name, price) VALUES
  ('SKU-1', 'Notebook', 12.50),
  ('SKU-2', 'Desk lamp', 45.00),
  ('SKU-3', 'Chair', 210.00);

INSERT INTO orders (customer_id, status, total_amount, currency) VALUES
  (1, 'delivered', 57.50, 'USD'),
  (1, 'cancelled', 210.00, 'USD'),
  (2, 'shipped',  45.00, 'EUR'),
  (3, 'delivered', 222.50, 'GBP'),
  (2, 'pending',   12.50, 'EUR');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 12.50), (1, 2, 1, 45.00),
  (2, 3, 1, 210.00),
  (3, 2, 1, 45.00),
  (4, 3, 1, 210.00), (4, 1, 1, 12.50),
  (5, 1, 1, 12.50);

INSERT INTO payments (order_id, amount, method) VALUES
  (1, 57.50, 'card'), (3, 45.00, 'card'), (4, 222.50, 'card');

INSERT INTO refunds (order_id, amount, reason) VALUES
  (1, 12.50, 'damaged item'),
  (4, 210.00, 'returned');

-- Quoted, mixed-case identifiers: common in Rails/EF/Prisma schemas and a
-- different code path from the all-lowercase tables above.
CREATE TABLE "OrderNotes" (
  id        serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES orders(id),
  note      text NOT NULL
);

INSERT INTO "OrderNotes" ("orderId", note) VALUES (1, 'left with neighbour');
