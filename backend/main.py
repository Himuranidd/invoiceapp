from contextlib import asynccontextmanager
import json
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "papertrail.sqlite3"


def connection() -> sqlite3.Connection:
    database = sqlite3.connect(DB_PATH)
    database.row_factory = sqlite3.Row
    return database


def initialize_database() -> None:
    with connection() as database:
        database.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                invoice_number TEXT NOT NULL,
                customer_name TEXT,
                invoice_date TEXT NOT NULL,
                total_cents INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
        """)
        database.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Papertrail Invoice API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InvoicePayload(BaseModel):
    id: str
    number: str
    date: str
    customer: dict[str, Any] = {}
    items: list[dict[str, Any]] = []
    model_config = {"extra": "allow"}


def total_cents(invoice: InvoicePayload) -> int:
    subtotal = sum(
        round(float(item.get("qty", 0)) * float(item.get("price", 0)) * (1 - float(item.get("discount", 0)) / 100) * 100)
        for item in invoice.items
    )
    discount = round(subtotal * float(getattr(invoice, "discount", 0) or 0) / 100)
    tax = round((subtotal - discount) * float(getattr(invoice, "tax", 0) or 0) / 100)
    shipping = round(float(getattr(invoice, "shipping", 0) or 0) * 100)
    return subtotal - discount + tax + shipping


def row_to_payload(row: sqlite3.Row) -> dict[str, Any]:
    return json.loads(row["payload"])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/invoices")
def list_invoices() -> list[dict[str, Any]]:
    with connection() as database:
        rows = database.execute("SELECT payload FROM invoices ORDER BY invoice_date DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: str) -> dict[str, Any]:
    with connection() as database:
        row = database.execute("SELECT payload FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return row_to_payload(row)


@app.post("/api/invoices", status_code=201)
def create_invoice(invoice: InvoicePayload) -> dict[str, Any]:
    payload = invoice.model_dump()
    with connection() as database:
        database.execute(
            "INSERT INTO invoices (id, invoice_number, customer_name, invoice_date, total_cents, payload) VALUES (?, ?, ?, ?, ?, ?)",
            (invoice.id, invoice.number, invoice.customer.get("name", ""), invoice.date, total_cents(invoice), json.dumps(payload)),
        )
        database.commit()
    return payload


@app.put("/api/invoices/{invoice_id}")
def update_invoice(invoice_id: str, invoice: InvoicePayload) -> dict[str, Any]:
    if invoice.id != invoice_id:
        raise HTTPException(status_code=400, detail="Invoice id does not match payload")
    payload = invoice.model_dump()
    with connection() as database:
        result = database.execute(
            "UPDATE invoices SET invoice_number = ?, customer_name = ?, invoice_date = ?, total_cents = ?, payload = ? WHERE id = ?",
            (invoice.number, invoice.customer.get("name", ""), invoice.date, total_cents(invoice), json.dumps(payload), invoice_id),
        )
        database.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return payload


@app.delete("/api/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: str) -> None:
    with connection() as database:
        result = database.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
        database.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
