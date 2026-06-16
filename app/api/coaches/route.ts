import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const coaches = db.prepare("SELECT * FROM coaches ORDER BY name").all();
  return NextResponse.json(coaches);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { name, contact = "", hourly_rate = 0, active = 1 } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const result = db
    .prepare("INSERT INTO coaches (name, contact, hourly_rate, active) VALUES (?, ?, ?, ?)")
    .run(name.trim(), contact, hourly_rate, active);

  const coach = db.prepare("SELECT * FROM coaches WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(coach, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { id, name, contact, hourly_rate, active } = body;

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  db.prepare(
    "UPDATE coaches SET name=?, contact=?, hourly_rate=?, active=? WHERE id=?"
  ).run(name, contact, hourly_rate, active, id);

  const coach = db.prepare("SELECT * FROM coaches WHERE id = ?").get(id);
  return NextResponse.json(coach);
}
