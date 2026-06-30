import { NextRequest, NextResponse } from "next/server";
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

export async function PATCH(req: NextRequest) {
  const db = getDb();
  const { id, venue_type } = await req.json();
  if (!id || !["school", "sports_hall"].includes(venue_type)) {
    return NextResponse.json({ error: "id and venue_type (school|sports_hall) required" }, { status: 400 });
  }
  db.prepare("UPDATE venues SET venue_type = ? WHERE id = ?").run(venue_type, id);
  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(id);
  return NextResponse.json(venue);
}
