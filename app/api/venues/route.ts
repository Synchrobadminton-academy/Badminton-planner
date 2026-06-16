import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const venues = db.prepare("SELECT * FROM venues ORDER BY name").all();
  return NextResponse.json(venues);
}

export async function POST(req: Request) {
  const db = getDb();
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const result = db.prepare("INSERT INTO venues (name) VALUES (?)").run(name.trim());
  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(venue, { status: 201 });
}
