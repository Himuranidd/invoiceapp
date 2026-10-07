from collections.abc import Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("PAPERTRAIL_DB_PATH", ROOT / "papertrail.sqlite3"))
logger = logging.getLogger(__name__)
SESSION_COOKIE = "papertrail_session"
PASSWORD_ITERATIONS = 600_000
SESSION_TTL = timedelta(hours=12)
REMEMBERED_SESSION_TTL = timedelta(days=30)
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")
DUMMY_SALT = b"papertrail-invalid-user-salt"
DUMMY_HASH = hashlib.pbkdf2_hmac("sha256", b"invalid-password", DUMMY_SALT, PASSWORD_ITERATIONS)

PUBLIC_ASSETS = {
    "main.css",
    "account-menu.css",
    "settings-dashboard.css",
    "app.js",
    "settings-ui.js",
    "account-actions.js",
    "auth.css",
    "auth.js",
    "auth.html",
    "offline.html",
    "manifest.webmanifest",
    "sw.js",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/the-walkin-logo.png",
}


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    database = sqlite3.connect(DB_PATH)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA foreign_keys = ON")
    try:
        with database:
            yield database
    finally:
        database.close()


def initialize_database() -> None:
    with connection() as database:
        database.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        database.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        database.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                invoice_number TEXT NOT NULL,
                customer_name TEXT,
                invoice_date TEXT NOT NULL,
                total_cents INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
        """)
        invoice_columns = {row["name"] for row in database.execute("PRAGMA table_info(invoices)")}
        if "owner_id" not in invoice_columns:
            database.execute("ALTER TABLE invoices ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE")
        database.execute("CREATE INDEX IF NOT EXISTS invoices_owner_date ON invoices(owner_id, invoice_date DESC)")
        database.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)")
        database.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    logger.info("SQLite database: %s", DB_PATH.resolve())
    yield


app = FastAPI(title="Manu Invoice Studio API", version="2.0.0", lifespan=lifespan)


class InvoicePayload(BaseModel):
    id: str
    number: str
    date: str
    customer: dict[str, Any] = Field(default_factory=dict)
    items: list[dict[str, Any]] = Field(default_factory=list)
    model_config = {"extra": "allow"}


class RegisterPayload(BaseModel):
    full_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    password_confirm: str = Field(min_length=1, max_length=128)


class LoginPayload(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


def now_utc() -> datetime:
    return datetime.now(UTC)


def normalize_email(value: str) -> str:
    email = value.strip().casefold()
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def cookie_is_secure() -> bool:
    return os.environ.get("PAPERTRAIL_COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes"}


def current_user(request: Request) -> sqlite3.Row:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    with connection() as database:
        row = database.execute(
            """
            SELECT users.id, users.full_name, users.email
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (hash_session_token(token), now_utc().isoformat()),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return row


def issue_session(user_id: str, response: Response, remember: bool = False) -> None:
    token = secrets.token_urlsafe(32)
    lifetime = REMEMBERED_SESSION_TTL if remember else SESSION_TTL
    expires_at = now_utc() + lifetime
    with connection() as database:
        database.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (hash_session_token(token), user_id, expires_at.isoformat(), now_utc().isoformat()),
        )
        database.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(lifetime.total_seconds()) if remember else None,
        httponly=True,
        secure=cookie_is_secure(),
        samesite="lax",
        path="/",
    )


def user_payload(user: sqlite3.Row) -> dict[str, str]:
    return {"id": user["id"], "full_name": user["full_name"], "email": user["email"]}


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


@app.get("/login")
@app.get("/register")
def auth_page() -> FileResponse:
    return FileResponse(ROOT / "auth.html", headers={"Cache-Control": "no-store"})


@app.get("/")
def home(request: Request) -> Response:
    try:
        current_user(request)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        return RedirectResponse("/login", status_code=303)
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/index.html")
def index_route() -> RedirectResponse:
    return RedirectResponse("/", status_code=303)


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterPayload, response: Response) -> dict[str, str]:
    full_name = payload.full_name.strip()
    if not full_name:
        raise HTTPException(status_code=422, detail="Enter your full name.")
    if payload.password != payload.password_confirm:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    email = normalize_email(payload.email)
    user_id = str(uuid4())
    salt = secrets.token_bytes(16)
    try:
        with connection() as database:
            database.execute(
                "INSERT INTO users (id, full_name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    full_name,
                    email,
                    salt.hex(),
                    password_digest(payload.password, salt).hex(),
                    now_utc().isoformat(),
                ),
            )
            database.commit()
    except sqlite3.IntegrityError as error:
        if "users.email" in str(error):
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from error
        raise
    issue_session(user_id, response)
    return {"id": user_id, "full_name": full_name, "email": email}


@app.post("/api/auth/login")
def login(payload: LoginPayload, response: Response) -> dict[str, str]:
    email = normalize_email(payload.email)
    with connection() as database:
        user = database.execute(
            "SELECT id, full_name, email, password_salt, password_hash FROM users WHERE email = ? COLLATE NOCASE",
            (email,),
        ).fetchone()
    salt = bytes.fromhex(user["password_salt"]) if user else DUMMY_SALT
    expected_hash = bytes.fromhex(user["password_hash"]) if user else DUMMY_HASH
    valid_password = hmac.compare_digest(password_digest(payload.password, salt), expected_hash)
    if user is None or not valid_password:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    issue_session(user["id"], response, payload.remember)
    return user_payload(user)


@app.get("/api/auth/session")
def get_session(user: sqlite3.Row = Depends(current_user)) -> dict[str, str]:
    return user_payload(user)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, user: sqlite3.Row = Depends(current_user)) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with connection() as database:
            database.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))
            database.commit()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=cookie_is_secure(), samesite="lax")
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/invoices")
def list_invoices(user: sqlite3.Row = Depends(current_user)) -> list[dict[str, Any]]:
    with connection() as database:
        rows = database.execute(
            "SELECT payload FROM invoices WHERE owner_id = ? ORDER BY invoice_date DESC",
            (user["id"],),
        ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: str, user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    with connection() as database:
        row = database.execute(
            "SELECT payload FROM invoices WHERE id = ? AND owner_id = ?",
            (invoice_id, user["id"]),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return row_to_payload(row)


@app.post("/api/invoices", status_code=201)
def create_invoice(invoice: InvoicePayload, user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    payload = invoice.model_dump()
    with connection() as database:
        database.execute(
            """
            INSERT INTO invoices (id, owner_id, invoice_number, customer_name, invoice_date, total_cents, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                invoice.id,
                user["id"],
                invoice.number,
                invoice.customer.get("name", ""),
                invoice.date,
                total_cents(invoice),
                json.dumps(payload),
            ),
        )
        database.commit()
    return payload


@app.put("/api/invoices/{invoice_id}")
def update_invoice(invoice_id: str, invoice: InvoicePayload, user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    if invoice.id != invoice_id:
        raise HTTPException(status_code=400, detail="Invoice id does not match payload")
    payload = invoice.model_dump()
    with connection() as database:
        result = database.execute(
            """
            UPDATE invoices
            SET invoice_number = ?, customer_name = ?, invoice_date = ?, total_cents = ?, payload = ?
            WHERE id = ? AND owner_id = ?
            """,
            (
                invoice.number,
                invoice.customer.get("name", ""),
                invoice.date,
                total_cents(invoice),
                json.dumps(payload),
                invoice_id,
                user["id"],
            ),
        )
        database.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return payload


@app.delete("/api/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: str, user: sqlite3.Row = Depends(current_user)) -> None:
    with connection() as database:
        result = database.execute(
            "DELETE FROM invoices WHERE id = ? AND owner_id = ?",
            (invoice_id, user["id"]),
        )
        database.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")


@app.get("/{asset_path:path}")
def public_asset(asset_path: str) -> FileResponse:
    if asset_path not in PUBLIC_ASSETS:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(ROOT / asset_path)
